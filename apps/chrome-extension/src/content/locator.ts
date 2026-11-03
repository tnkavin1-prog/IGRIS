/**
 * Semantic element grounding.
 *
 * Priority order (mirrors the product spec):
 *   reference → role+name → label → visible text → attributes → index.
 * A weak match is never silently accepted when the caller asked for a role.
 */
import { ERROR_CODES, ToolError, type TargetLocator } from '@gbl/shared';
import {
  accessibleName,
  collectInteractive,
  isInViewport,
  isInteractive,
  isVisible,
  roleOf,
} from './dom.js';
import { registry } from './registry.js';

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function labelText(el: Element): string {
  const labels = (el as HTMLInputElement).labels;
  if (!labels) return '';
  return Array.from(labels)
    .map((label) => label.innerText || label.textContent || '')
    .join(' ');
}

function candidateTexts(el: Element): string[] {
  const values = [
    accessibleName(el),
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('title') ?? '',
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('alt') ?? '',
    el.getAttribute('name') ?? '',
    labelText(el),
    (el as HTMLElement).innerText ?? '',
    (el as HTMLInputElement).value ?? '',
  ];
  return values.map(normalize).filter(Boolean);
}

function scoreElement(el: Element, locator: TargetLocator): number {
  const wantedRole = locator.role ? normalize(locator.role) : '';
  if (wantedRole) {
    const actual = normalize(roleOf(el));
    if (actual !== wantedRole) {
      // A button inside a link is a common and acceptable match for role=link.
      const nestedMatch =
        (wantedRole === 'link' && actual === 'button') ||
        (wantedRole === 'button' && actual === 'link');
      if (!nestedMatch) return -1;
    }
  }

  if (locator.name) {
    const name = normalize(el.getAttribute('name') ?? '');
    if (!name.includes(normalize(locator.name))) return -1;
  }

  let score = 0;
  let matchedAny = false;

  if (locator.label) {
    const normalizedLabel = normalize(locator.label);
    const actualLabel = normalize(labelText(el));
    if (!actualLabel) return -1;
    if (actualLabel === normalizedLabel) {
      score += 120;
      matchedAny = true;
    } else if (actualLabel.includes(normalizedLabel)) {
      score += 70;
      matchedAny = true;
    } else {
      return -1;
    }
  }

  if (locator.text) {
    const query = normalize(locator.text);
    if (query) {
      const texts = candidateTexts(el);
      let best = 0;
      for (const text of texts) {
        if (text === query) best = Math.max(best, 100);
        else if (text.startsWith(query)) best = Math.max(best, 75);
        else if (text.includes(query)) best = Math.max(best, 55);
        else if (query.length > 6 && text.length > 3 && query.includes(text))
          best = Math.max(best, 35);
      }
      if (best === 0) return -1;
      score += best;
      matchedAny = true;
    }
  }

  if (!matchedAny && !wantedRole && !locator.name) return -1;

  if (isInViewport(el)) score += 6;
  if ((el as HTMLButtonElement).disabled) score -= 40;
  if (el.getAttribute('aria-disabled') === 'true') score -= 40;

  return score;
}

export function findCandidates(locator: TargetLocator): Array<{ element: Element; score: number }> {
  const pool = collectInteractive(document);
  const results: Array<{ element: Element; score: number }> = [];
  for (const element of pool) {
    const score = scoreElement(element, locator);
    if (score >= 0) results.push({ element, score });
  }
  // Include non-interactive matches for read-only inspection (find_element).
  if (results.length === 0 && locator.text) {
    const query = normalize(locator.text);
    const all = Array.from(document.querySelectorAll('body *'));
    for (const element of all) {
      if (results.length >= 20) break;
      if (!isVisible(element)) continue;
      if (element.children.length > 3) continue;
      const text = normalize((element as HTMLElement).innerText ?? '');
      if (!text || text.length > 240) continue;
      if (text === query) results.push({ element, score: 90 });
      else if (text.includes(query)) results.push({ element, score: 40 });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Resolve exactly one element.
 *
 * `index` selects among equally good matches; without it, ambiguity between
 * distinct high-confidence matches is reported rather than guessed.
 */
export function resolveLocator(locator: TargetLocator): Element {
  if (locator.ref) return registry.resolve(locator.ref);

  const candidates = findCandidates(locator);
  if (candidates.length === 0) {
    throw new ToolError(
      ERROR_CODES.ELEMENT_NOT_FOUND,
      `No visible element matched ${describeLocator(locator)}.`,
      {
        hint: 'Call get_page_snapshot to see the current elements and their references.',
        retryable: true,
      },
    );
  }

  const requestedIndex = locator.index;
  if (typeof requestedIndex === 'number') {
    const chosen = candidates[requestedIndex];
    if (!chosen) {
      throw new ToolError(
        ERROR_CODES.ELEMENT_NOT_FOUND,
        `Only ${candidates.length} element(s) matched; index ${requestedIndex} is out of range.`,
        { retryable: true },
      );
    }
    return chosen.element;
  }

  const best = candidates[0]!;
  const second = candidates[1];
  if (second && best.score === second.score && best.score >= 55) {
    const names = candidates
      .slice(0, 4)
      .map((c) => `"${accessibleName(c.element).slice(0, 40)}"`)
      .join(', ');
    throw new ToolError(
      ERROR_CODES.ELEMENT_NOT_FOUND,
      `Ambiguous target: ${candidates.length} elements match equally (${names}).`,
      { hint: 'Pass an element reference from get_page_snapshot, or an index to disambiguate.' },
    );
  }
  return best.element;
}

export function describeLocator(locator: TargetLocator): string {
  const parts: string[] = [];
  if (locator.ref) parts.push(`ref ${locator.ref}`);
  if (locator.role) parts.push(`role ${locator.role}`);
  if (locator.text) parts.push(`text "${locator.text}"`);
  if (locator.label) parts.push(`label "${locator.label}"`);
  if (locator.name) parts.push(`name "${locator.name}"`);
  return parts.join(' ') || 'the given locator';
}

/** Which interactive element actually sits at a viewport point. */
export function interactiveAtPoint(x: number, y: number): Element | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  if (isInteractive(hit)) return hit;
  const ancestor = hit.closest(
    'a,button,input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[tabindex]',
  );
  return ancestor ?? hit;
}
