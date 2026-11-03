/**
 * Page reading: semantic snapshots and structured extraction.
 * Everything here is read-only and bounded, so a pathological page cannot
 * blow up the model context or the UI.
 */
import { LIMITS, normalizePageText, type PageSnapshot, type PageFingerprint } from '@gbl/shared';
import {
  accessibleName,
  collectInteractive,
  describeElement,
  fullDocumentText,
  isInteractive,
  isVisible,
  roleOf,
  sanitizeUrl,
  visibleDocumentText,
  type DescribeOptions,
} from './dom.js';
import { registry } from './registry.js';

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fingerprint(): PageFingerprint {
  const elements = collectInteractive(document, 200).length;
  const textLength = document.body?.textContent?.length ?? 0;
  const state = [
    location.href,
    document.title,
    String(elements),
    String(textLength),
    String(Math.round(window.scrollY)),
    (document.body?.textContent ?? '').slice(0, 600),
  ].join('|');
  return {
    url: location.href,
    title: document.title,
    generation: registry.generation,
    scrollY: Math.round(window.scrollY),
    scrollMax: Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight)),
    elementCount: elements,
    textLength,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    digest: fnv1a(state),
  };
}

/** Collapse repetitive boilerplate lines so the text budget buys real content. */
function dedupeLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let previous = '';
  let repeats = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      previous = '';
      continue;
    }
    if (trimmed === previous) {
      repeats += 1;
      if (repeats > 2) continue;
    } else {
      repeats = 0;
    }
    previous = trimmed;
    out.push(trimmed);
  }
  return out.join('\n').trim();
}

export interface SnapshotOptions {
  maxTextChars?: number;
  maxElements?: number;
}

export function buildSnapshot(options: SnapshotOptions = {}): PageSnapshot {
  const maxText = Math.min(
    Math.max(options.maxTextChars ?? 6_000, 200),
    LIMITS.snapshotTextChars + 3_000,
  );
  const maxElements = Math.min(Math.max(options.maxElements ?? 80, 5), 150);

  const rawText = visibleDocumentText(maxText * 2);
  const deduped = dedupeLines(rawText);
  const text = deduped.slice(0, maxText);
  const textTruncated = deduped.length > text.length;

  const interactive = collectInteractive(document, 400);
  const elements = interactive
    .slice(0, maxElements)
    .map((element) => describeElement(element, { ref: registry.refFor(element) }));

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
    .filter((heading) => isVisible(heading))
    .slice(0, 40)
    .map((heading) => normalizePageText((heading as HTMLElement).innerText ?? '').slice(0, 160))
    .filter(Boolean);

  return {
    url: location.href,
    title: document.title,
    generation: registry.generation,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    scroll: {
      y: Math.round(window.scrollY),
      max: Math.max(0, Math.round(document.documentElement.scrollHeight - window.innerHeight)),
    },
    headings,
    text,
    textTruncated,
    elements,
    elementsTruncated: interactive.length > elements.length,
    counts: {
      links: document.querySelectorAll('a[href]').length,
      images: document.querySelectorAll('img').length,
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input,textarea,select').length,
    },
    fingerprint: fingerprint(),
  };
}

export function visibleText(maxChars: number): string {
  return dedupeLines(visibleDocumentText(maxChars)).slice(0, maxChars);
}

export function fullText(maxChars: number): string {
  return dedupeLines(fullDocumentText(maxChars)).slice(0, maxChars);
}

export function headings(): string[] {
  return Array.from(document.querySelectorAll('h1,h2,h3,h4'))
    .filter((heading) => isVisible(heading))
    .slice(0, 80)
    .map((heading) => normalizePageText((heading as HTMLElement).innerText ?? '').slice(0, 200))
    .filter(Boolean);
}

export interface LinkResult {
  text: string;
  url: string;
  ref?: string;
  kind?: string;
}

export function extractLinks(query: string | undefined, limit: number): LinkResult[] {
  const needle = (query ?? '').trim().toLowerCase();
  const out: LinkResult[] = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const anchor of anchors) {
    if (out.length >= limit) break;
    if (!isVisible(anchor)) continue;
    const text = accessibleName(anchor) || (anchor as HTMLElement).innerText || '';
    const url = (anchor as HTMLAnchorElement).href;
    if (!url || url.startsWith('javascript:')) continue;
    if (needle) {
      const haystack = `${text} ${url}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const kindMatch = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url);
    out.push({
      text: normalizePageText(text).slice(0, 180),
      url: sanitizeUrl(url),
      ref: registry.refFor(anchor),
      ...(kindMatch?.[1] ? { kind: kindMatch[1].toLowerCase() } : {}),
    });
  }
  return out;
}

export interface ImageResult {
  alt: string;
  src: string;
  host: string;
  width: number;
  height: number;
  ref?: string;
}

export function extractImages(limit: number): ImageResult[] {
  const out: ImageResult[] = [];
  for (const img of Array.from(document.querySelectorAll('img'))) {
    if (out.length >= limit) break;
    const element = img as HTMLImageElement;
    if (!isVisible(element)) continue;
    const src = element.currentSrc || element.src;
    if (!src) continue;
    let host: string;
    try {
      host = new URL(src).hostname;
    } catch {
      host = '';
    }
    const parentLink = element.closest('a[href]');
    out.push({
      alt: normalizePageText(element.alt || '').slice(0, 160),
      src: sanitizeUrl(src),
      host,
      width: element.naturalWidth || Math.round(element.getBoundingClientRect().width),
      height: element.naturalHeight || Math.round(element.getBoundingClientRect().height),
      ...(parentLink ? { ref: registry.refFor(parentLink) } : {}),
    });
  }
  return out;
}

export interface FindMatch {
  ref?: string;
  text: string;
  context: string;
  tag: string;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

/** Find literal text, scroll the first hit into view, and highlight briefly. */
export function findText(query: string, maxMatches = 8): { count: number; matches: FindMatch[] } {
  const needle = query.trim().toLowerCase();
  const matches: FindMatch[] = [];
  if (!needle) return { count: 0, matches };

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.nextNode();
  while (node && matches.length < maxMatches) {
    const value = node.nodeValue ?? '';
    const index = value.toLowerCase().indexOf(needle);
    if (index >= 0) {
      const parent = node.parentElement;
      if (parent && isVisible(parent)) {
        const start = Math.max(0, index - 70);
        const end = Math.min(value.length, index + needle.length + 90);
        const interactiveAncestor = parent.closest(
          'a,button,input,select,textarea,[role="button"],[role="link"]',
        );
        matches.push({
          text: normalizePageText(value.slice(index, index + 160)),
          context: normalizePageText(value.slice(start, end)),
          tag: parent.tagName.toLowerCase(),
          ...(interactiveAncestor ? { ref: registry.refFor(interactiveAncestor) } : {}),
        });
        if (matches.length === 1) {
          parent.scrollIntoView({ block: 'center', inline: 'nearest' });
          highlight(parent);
        }
      }
    }
    node = walker.nextNode();
  }
  return { count: matches.length, matches };
}

export function highlight(element: Element, durationMs = 2_400): void {
  const el = element as HTMLElement;
  const previousOutline = el.style.outline;
  const previousOffset = el.style.outlineOffset;
  el.style.outline = '2px solid #7c8cff';
  el.style.outlineOffset = '2px';
  window.setTimeout(() => {
    el.style.outline = previousOutline;
    el.style.outlineOffset = previousOffset;
  }, durationMs);
}

export interface StructureResult {
  url: string;
  title: string;
  landmarks: Array<{ role: string; name: string }>;
  forms: Array<{ action: string; method: string; fields: number; submitLabel: string }>;
  tables: Array<{ index: number; rows: number; columns: number; caption: string }>;
  dialogs: string[];
  counts: {
    headings: number;
    interactive: number;
    iframes: number;
    shadowRoots: number;
    images: number;
    links: number;
  };
}

export function pageStructure(): StructureResult {
  const landmarkSelectors = [
    'header',
    'nav',
    'main',
    'aside',
    'footer',
    'section',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="main"]',
    '[role="complementary"]',
    '[role="contentinfo"]',
    '[role="dialog"]',
  ];
  const landmarks: Array<{ role: string; name: string }> = [];
  for (const element of Array.from(document.querySelectorAll(landmarkSelectors.join(',')))) {
    if (landmarks.length >= 30) break;
    if (!isVisible(element)) continue;
    landmarks.push({
      role: roleOf(element),
      name: accessibleName(element).slice(0, 100) || element.tagName.toLowerCase(),
    });
  }

  const forms = Array.from(document.querySelectorAll('form'))
    .filter((form) => isVisible(form))
    .slice(0, 20)
    .map((form) => {
      const submit = form.querySelector<HTMLElement>(
        'button[type="submit"],input[type="submit"],button:not([type])',
      );
      return {
        action: sanitizeUrl(form.getAttribute('action') ?? '') || '(none)',
        method: (form.getAttribute('method') ?? 'get').toUpperCase(),
        fields: form.querySelectorAll('input,textarea,select').length,
        submitLabel: submit ? accessibleName(submit).slice(0, 80) : '',
      };
    });

  const tables = Array.from(document.querySelectorAll('table'))
    .filter((table) => isVisible(table))
    .slice(0, 20)
    .map((table, index) => {
      const firstRow = table.querySelector('tr');
      return {
        index,
        rows: table.querySelectorAll('tr').length,
        columns: firstRow ? firstRow.querySelectorAll('th,td').length : 0,
        caption: normalizePageText(
          table.querySelector('caption')?.textContent ?? table.getAttribute('aria-label') ?? '',
        ).slice(0, 120),
      };
    });

  const dialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog[open]'))
    .filter((dialog) => isVisible(dialog))
    .slice(0, 10)
    .map((dialog) => {
      const heading = dialog.querySelector('h1,h2,h3,[role="heading"]');
      return normalizePageText(
        (heading as HTMLElement | null)?.innerText ?? dialog.getAttribute('aria-label') ?? 'dialog',
      ).slice(0, 140);
    });

  let shadowRoots = 0;
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if ((element as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot) shadowRoots += 1;
  }

  return {
    url: location.href,
    title: document.title,
    landmarks,
    forms,
    tables,
    dialogs,
    counts: {
      headings: document.querySelectorAll('h1,h2,h3,h4').length,
      interactive: collectInteractive(document, 500).length,
      iframes: document.querySelectorAll('iframe').length,
      shadowRoots,
      images: document.querySelectorAll('img').length,
      links: document.querySelectorAll('a[href]').length,
    },
  };
}

export function tableData(
  index: number,
  maxRows: number,
): { rows: string[][]; truncated: boolean; columns: number } {
  const tables = Array.from(document.querySelectorAll('table')).filter((table) => isVisible(table));
  const table = tables[index];
  if (!table) {
    return { rows: [], truncated: false, columns: 0 };
  }
  const rows: string[][] = [];
  const trs = Array.from(table.querySelectorAll('tr'));
  let columns = 0;
  for (const tr of trs) {
    if (rows.length >= maxRows) break;
    const cells = Array.from(tr.querySelectorAll('th,td')).slice(0, 20);
    if (cells.length === 0) continue;
    columns = Math.max(columns, cells.length);
    rows.push(
      cells.map((cell) => normalizePageText((cell as HTMLElement).innerText ?? '').slice(0, 300)),
    );
  }
  return { rows, truncated: trs.length > rows.length, columns };
}

export function elementState(ref: string): Record<string, unknown> {
  const element = registry.resolve(ref);
  const options: DescribeOptions = { ref, includeValue: true };
  const summary = describeElement(element, options);
  const rect = element.getBoundingClientRect();
  return {
    ...summary,
    visible: isVisible(element),
    interactive: isInteractive(element),
    inViewport:
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth,
    attributes: {
      id: element.id || undefined,
      name: element.getAttribute('name') ?? undefined,
      role: element.getAttribute('role') ?? undefined,
      type: (element as HTMLInputElement).type ?? undefined,
      autocomplete: element.getAttribute('autocomplete') ?? undefined,
    },
  };
}
