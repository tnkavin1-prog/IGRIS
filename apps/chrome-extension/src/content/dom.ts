/**
 * DOM primitives: visibility, accessibility, roles, redaction, description.
 * These are the foundation of element grounding; everything else builds on them.
 */
import { isSensitiveFieldDescriptor, normalizePageText } from '@gbl/shared';
import type { BoundingBox, ElementSummary } from '@gbl/shared';

type AnyElement = Element & {
  checkVisibility?: (options?: {
    checkOpacity?: boolean;
    checkVisibilityCSS?: boolean;
    contentVisibilityAuto?: boolean;
    opacityProperty?: boolean;
    visibilityProperty?: boolean;
  }) => boolean;
  labels?: NodeListOf<HTMLLabelElement> | null;
  form?: HTMLFormElement | null;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  selected?: boolean;
  type?: string;
  href?: string;
  isContentEditable?: boolean;
};

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'password']);

export function isElement(node: unknown): node is Element {
  return Boolean(node) && typeof node === 'object' && (node as Node).nodeType === 1;
}

export function isHtmlElement(node: unknown): node is HTMLElement {
  return isElement(node) && node.ownerDocument?.defaultView?.HTMLElement !== undefined
    ? node instanceof node.ownerDocument.defaultView.HTMLElement
    : false;
}

/** True when the element renders with non-zero size and is not hidden. */
export function isVisible(el: Element): boolean {
  const anyEl = el as AnyElement;
  if (typeof anyEl.checkVisibility === 'function') {
    try {
      const visible = anyEl.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
      });
      if (!visible) return false;
    } catch {
      /* older Chrome: fall through to geometric checks */
    }
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (Number.parseFloat(style.opacity || '1') === 0) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest('[inert]')) return false;
  return true;
}

export function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  return (
    rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth
  );
}

export function boundingBox(el: Element): BoundingBox {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  form: 'form',
  footer: 'contentinfo',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner',
  img: 'img',
  input: 'textbox',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  select: 'combobox',
  summary: 'button',
  table: 'table',
  td: 'cell',
  textarea: 'textbox',
  th: 'columnheader',
  tr: 'row',
  ul: 'list',
};

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el as AnyElement).type?.toLowerCase() ?? 'text';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image')
      return 'button';
    if (type === 'search') return 'searchbox';
    if (TEXT_INPUT_TYPES.has(type)) return 'textbox';
    return 'input';
  }
  if (tag === 'a' && !el.hasAttribute('href')) return 'generic';
  return IMPLICIT_ROLES[tag] ?? 'generic';
}

function labelledByText(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const doc = el.ownerDocument;
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

/** Approximate accname computation — good enough for grounding, not a11y audit. */
export function accessibleName(el: Element): string {
  const anyEl = el as AnyElement;
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return normalizeName(aria);

  const fromLabelledBy = labelledByText(el);
  if (fromLabelledBy) return normalizeName(fromLabelledBy);

  if (anyEl.labels && anyEl.labels.length > 0) {
    const text = Array.from(anyEl.labels)
      .map((label) => label.innerText || label.textContent || '')
      .join(' ');
    if (text.trim()) return normalizeName(text);
  }

  const alt = el.getAttribute('alt');
  if (alt?.trim()) return normalizeName(alt);

  if (el.tagName.toLowerCase() === 'input') {
    const type = (anyEl.type ?? '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const value = anyEl.value ?? '';
      if (value.trim()) return normalizeName(value);
    }
    // A text input's own value is content, not its name.
  }

  const title = el.getAttribute('title');
  if (title?.trim()) return normalizeName(title);

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return normalizeName(placeholder);

  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return normalizeName(text);
}

export function normalizeName(value: string): string {
  return normalizePageText(value).replace(/\s+/g, ' ').slice(0, 200);
}

export function isSensitiveElement(el: Element): boolean {
  const anyEl = el as AnyElement;
  const labels = anyEl.labels
    ? Array.from(anyEl.labels)
        .map((l) => l.innerText)
        .join(' ')
    : '';
  return isSensitiveFieldDescriptor({
    type: anyEl.type,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label: labels || undefined,
    placeholder: el.getAttribute('placeholder') ?? undefined,
    role: el.getAttribute('role') ?? undefined,
  });
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function isInteractive(el: Element): boolean {
  if (el.matches(INTERACTIVE_SELECTOR)) return true;
  const role = roleOf(el);
  if (INTERACTIVE_ROLES.has(role)) return true;
  if ((el as AnyElement).isContentEditable) return true;
  return false;
}

/**
 * Collect interactive elements, descending into open shadow roots and
 * same-origin iframes. Closed shadow roots and cross-origin frames are
 * inaccessible by design; the agent is told about that limitation.
 */
export function collectInteractive(root: Document | ShadowRoot | Element, limit = 400): Element[] {
  const out: Element[] = [];
  const visit = (node: Document | ShadowRoot | Element, depth: number): void => {
    if (out.length >= limit || depth > 8) return;
    let found: Element[];
    try {
      found = Array.from(node.querySelectorAll(INTERACTIVE_SELECTOR));
    } catch {
      return;
    }
    for (const el of found) {
      if (out.length >= limit) return;
      if (!isVisible(el)) continue;
      out.push(el);
    }
    // Open shadow roots
    let hosts: Element[];
    try {
      hosts = Array.from(node.querySelectorAll('*'));
    } catch {
      hosts = [];
    }
    for (const host of hosts) {
      if (out.length >= limit) return;
      const shadow = (host as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      if (shadow) visit(shadow, depth + 1);
    }
    // Same-origin iframes only.
    let frames: HTMLIFrameElement[];
    try {
      frames = Array.from(node.querySelectorAll('iframe'));
    } catch {
      frames = [];
    }
    for (const frame of frames) {
      if (out.length >= limit) return;
      try {
        const doc = frame.contentDocument;
        if (doc?.body) visit(doc, depth + 1);
      } catch {
        /* cross-origin */
      }
    }
  };
  visit(root, 0);
  return out;
}

const SENSITIVE_QUERY_KEYS =
  /(token|auth|session|api[_-]?key|secret|password|credential|signature|^sig$|^code$)/i;

export function sanitizeUrl(raw: string | undefined | null): string {
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://placeholder.invalid');
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.test(key)) url.searchParams.delete(key);
    }
    if (url.origin === 'https://placeholder.invalid') return raw.slice(0, 500);
    return url.toString().slice(0, 500);
  } catch {
    return String(raw).slice(0, 500);
  }
}

function nearestContext(el: Element): string | undefined {
  const form = (el as AnyElement).form ?? el.closest('form');
  if (form) {
    const legend = form.querySelector('legend')?.textContent ?? '';
    const heading = form.querySelector('h1,h2,h3')?.textContent ?? '';
    const text = normalizePageText(legend || heading || '');
    if (text) return text.slice(0, 120);
    return 'form';
  }
  const dialog = el.closest('[role="dialog"],dialog');
  if (dialog) {
    const heading = dialog.querySelector('h1,h2,h3')?.textContent ?? '';
    return heading ? normalizePageText(heading).slice(0, 120) : 'dialog';
  }
  const nav = el.closest('nav,header,footer,aside');
  if (nav) {
    const label = nav.getAttribute('aria-label') || nav.tagName.toLowerCase();
    return label.slice(0, 80);
  }
  return undefined;
}

export interface DescribeOptions {
  ref: string;
  includeValue?: boolean;
}

export function describeElement(el: Element, options: DescribeOptions): ElementSummary {
  const anyEl = el as AnyElement;
  const tag = el.tagName.toLowerCase();
  const sensitive = isSensitiveElement(el);
  const summary: ElementSummary = {
    ref: options.ref,
    role: roleOf(el),
    name: accessibleName(el),
    tag,
    bbox: boundingBox(el),
  };

  const type = anyEl.type;
  if (type) summary.type = String(type);
  if (tag === 'a' && anyEl.href) summary.href = sanitizeUrl(anyEl.href);
  if (typeof anyEl.disabled === 'boolean' && anyEl.disabled) summary.disabled = true;
  if (typeof anyEl.checked === 'boolean') summary.checked = anyEl.checked;
  if (tag === 'option') summary.selected = Boolean(anyEl.selected);

  if (options.includeValue !== false && !sensitive) {
    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const selected = select.selectedOptions?.[0];
      if (selected?.text) summary.value = selected.text.slice(0, 120);
    } else if (tag === 'input' || tag === 'textarea') {
      const value = anyEl.value ?? '';
      if (value && (type ?? '') !== 'password') summary.value = value.slice(0, 200);
    } else if ((el as HTMLElement).isContentEditable) {
      const text = (el as HTMLElement).innerText ?? '';
      if (text.trim()) summary.value = text.slice(0, 200);
    }
  }

  const context = nearestContext(el);
  if (context) summary.context = context;

  return summary;
}

/** Form-level context used by the approval engine. */
export function inspectFormContext(el: Element): {
  inForm: boolean;
  formAction?: string;
  formText: string;
  isSubmitLike: boolean;
  submitControl?: Element;
} {
  const form = (el as AnyElement).form ?? el.closest('form');
  const anyEl = el as AnyElement;
  const type = (anyEl.type ?? '').toLowerCase();
  const tag = el.tagName.toLowerCase();
  const explicitType = (el.getAttribute('type') ?? '').toLowerCase();
  const isSubmitControl =
    (tag === 'input' && (type === 'submit' || type === 'image')) ||
    (tag === 'button' && explicitType === 'submit') ||
    (tag === 'button' && !el.hasAttribute('type') && Boolean(form));
  const isSubmitLike =
    isSubmitControl ||
    /submit|send|apply|pay|confirm|continue|next|save|post|publish/i.test(accessibleName(el));

  if (!form) {
    return {
      inForm: false,
      formText: '',
      isSubmitLike,
      submitControl: isSubmitLike ? el : undefined,
    };
  }

  const submitControl =
    form.querySelector<Element>('button[type="submit"],input[type="submit"],button:not([type])') ??
    undefined;

  const formAction = form.getAttribute('action') ? sanitizeUrl(form.action) : undefined;
  const text = normalizePageText(form.innerText || form.textContent || '');
  return {
    inForm: true,
    ...(formAction ? { formAction } : {}),
    formText: text.slice(0, 400),
    isSubmitLike,
    ...(submitControl ? { submitControl } : {}),
  };
}

/** Text of the document that a human would actually see. */
export function visibleDocumentText(maxChars: number): string {
  const body = document.body;
  if (!body) return '';
  const raw = (body as HTMLElement).innerText || body.textContent || '';
  return normalizePageText(raw).slice(0, maxChars);
}

export function fullDocumentText(maxChars: number): string {
  const root = document.body ?? document.documentElement;
  if (!root) return '';
  const raw = root.textContent ?? '';
  return normalizePageText(raw).slice(0, maxChars);
}
