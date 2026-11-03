/**
 * Page interaction engine.
 *
 * Every action follows the same contract:
 *   1. resolve exactly one visible element,
 *   2. capture a fingerprint before touching the page,
 *   3. verify the point is actually clickable (no invisible overlay),
 *   4. dispatch realistic pointer/keyboard events,
 *   5. capture a fingerprint afterwards and report whether anything changed.
 *
 * The caller (the agent orchestrator) never gets to claim success without this
 * evidence. Synthetic events are used because MV3 extensions cannot drive CDP
 * without the `debugger` permission, which this product deliberately avoids.
 */
import {
  ERROR_CODES,
  ToolError,
  type ActionResult,
  type ElementSummary,
  type InspectionResult,
  type PageFingerprint,
  type TargetLocator,
} from '@gbl/shared';
import {
  accessibleName,
  collectInteractive,
  describeElement,
  inspectFormContext,
  isSensitiveElement,
  isVisible,
  roleOf,
} from './dom.js';
import { findCandidates, interactiveAtPoint, resolveLocator } from './locator.js';
import { fingerprint, highlight } from './reader.js';
import { registry } from './registry.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function beforeFingerprint(): PageFingerprint {
  return fingerprint();
}

async function afterFingerprint(delayMs = 220): Promise<PageFingerprint | undefined> {
  try {
    await sleep(delayMs);
    return fingerprint();
  } catch {
    // The document can be torn down mid-navigation; the side panel verifies
    // navigation independently through chrome.tabs.
    return undefined;
  }
}

function changed(before: PageFingerprint, after: PageFingerprint | undefined): boolean {
  if (!after) return true;
  return (
    before.url !== after.url ||
    before.title !== after.title ||
    before.digest !== after.digest ||
    before.scrollY !== after.scrollY
  );
}

function actionResult(
  action: string,
  before: PageFingerprint,
  after: PageFingerprint | undefined,
  target?: ElementSummary,
  note?: string,
): ActionResult {
  const didChange = changed(before, after);
  return {
    action,
    ...(target ? { target } : {}),
    before,
    ...(after ? { after } : {}),
    changed: didChange,
    ...(note ? { note } : {}),
    ...(!didChange && !note
      ? { note: 'No observable page change yet. Re-read the page to verify the result.' }
      : {}),
  };
}

function pointerInit(x: number, y: number, buttons: number): PointerEventInit {
  return {
    bubbles: true,
    composed: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
}

function dispatchPointer(el: Element, type: string, x: number, y: number, buttons: number): void {
  const init = pointerInit(x, y, buttons);
  try {
    el.dispatchEvent(new PointerEvent(type, init));
  } catch {
    el.dispatchEvent(new MouseEvent(type, init));
  }
}

function dispatchMouse(el: Element, type: string, x: number, y: number, buttons: number): void {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
    }),
  );
}

function centerOf(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Confirm the point resolves to the intended element (or a descendant).
 * Shadow DOM hosts are accepted because `elementFromPoint` retargets to the
 * host, while `el.click()` still reaches the inner control.
 */
function hitTestMatches(el: Element, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return false;
  if (hit === el || el.contains(hit) || hit.contains(el)) return true;

  // Retarget through open shadow roots.
  let current: Element | null = el;
  while (current) {
    const root = current.getRootNode();
    if (root instanceof ShadowRoot && root.host) {
      if (root.host === hit || root.host.contains(hit) || hit.contains(root.host)) return true;
      current = root.host;
    } else {
      break;
    }
  }
  return false;
}

function ensureActionable(el: Element): void {
  if (!isVisible(el)) {
    throw new ToolError(ERROR_CODES.ELEMENT_NOT_VISIBLE, 'The element is no longer visible.', {
      hint: 'Scroll it into view or dismiss any overlay, then re-read the page.',
      retryable: true,
    });
  }
  const anyEl = el as HTMLElement & { disabled?: boolean };
  if (anyEl.disabled) {
    throw new ToolError(ERROR_CODES.ELEMENT_DISABLED, 'The control is disabled.', {
      hint: 'Look for a prerequisite field, a consent checkbox, or a loading state.',
      retryable: false,
    });
  }
  if (el.getAttribute('aria-disabled') === 'true') {
    throw new ToolError(ERROR_CODES.ELEMENT_DISABLED, 'The control is marked aria-disabled.', {
      hint: 'Wait for the control to become enabled.',
      retryable: false,
    });
  }
}

export interface ClickOptions {
  locator: TargetLocator;
  /** Skip the scroll-into-view step for coordinate clicks already in view. */
  alreadyVisible?: boolean;
}

export async function performClick(options: ClickOptions): Promise<ActionResult> {
  const el = resolveLocator(options.locator);
  ensureActionable(el);
  if (!options.alreadyVisible) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await sleep(40);
  }
  const { x, y } = centerOf(el);
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
    throw new ToolError(ERROR_CODES.ELEMENT_NOT_VISIBLE, 'The element is outside the viewport.', {
      hint: 'Scroll it into view, then retry.',
      retryable: true,
    });
  }
  if (!hitTestMatches(el, x, y)) {
    throw new ToolError(
      ERROR_CODES.ELEMENT_NOT_VISIBLE,
      'Another element covers the target at its center point.',
      {
        hint: 'Dismiss the overlay or dialog, re-read the page, and retry.',
        retryable: true,
      },
    );
  }

  const target = describeElement(el, { ref: registry.refFor(el) });
  const before = beforeFingerprint();
  highlight(el, 900);

  dispatchPointer(el, 'pointerover', x, y, 0);
  dispatchMouse(el, 'mouseover', x, y, 0);
  dispatchPointer(el, 'pointerenter', x, y, 0);
  dispatchMouse(el, 'mouseenter', x, y, 0);
  dispatchPointer(el, 'pointermove', x, y, 0);
  dispatchMouse(el, 'mousemove', x, y, 0);
  dispatchPointer(el, 'pointerdown', x, y, 1);
  dispatchMouse(el, 'mousedown', x, y, 1);

  if (el instanceof HTMLElement) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* focus can be refused by the page */
    }
  }

  dispatchPointer(el, 'pointerup', x, y, 0);
  dispatchMouse(el, 'mouseup', x, y, 0);
  // Native click preserves browser defaults (link navigation, checkbox toggle,
  // implicit form submit) that synthetic MouseEvents do not trigger.
  (el as HTMLElement).click();

  const after = await afterFingerprint();
  return actionResult('click', before, after, target);
}

export async function performHover(locator: TargetLocator): Promise<ActionResult> {
  const el = resolveLocator(locator);
  ensureActionable(el);
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  await sleep(40);
  const { x, y } = centerOf(el);
  const target = describeElement(el, { ref: registry.refFor(el) });
  const before = beforeFingerprint();

  dispatchPointer(el, 'pointerover', x, y, 0);
  dispatchMouse(el, 'mouseover', x, y, 0);
  dispatchPointer(el, 'pointermove', x, y, 0);
  dispatchMouse(el, 'mousemove', x, y, 0);

  await sleep(320);
  const after = fingerprint();
  const result = actionResult('hover', before, after, target);
  const menus = Array.from(
    document.querySelectorAll('[role="menu"],[role="tooltip"],[role="listbox"]'),
  )
    .filter(isVisible)
    .slice(0, 6)
    .map((menu) => accessibleName(menu).slice(0, 120))
    .filter(Boolean);
  if (menus.length > 0) {
    result.note = `Visible menus/tooltips: ${menus.join(' · ')}`;
    result.changed = true;
  }
  return result;
}

export async function scrollPage(
  direction: 'up' | 'down' | 'top' | 'bottom',
  amount: number,
): Promise<ActionResult> {
  const before = beforeFingerprint();
  if (direction === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
  else if (direction === 'bottom') {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  } else {
    window.scrollBy({ top: direction === 'down' ? amount : -amount, behavior: 'instant' });
  }
  const after = await afterFingerprint(180);
  const result = actionResult('scroll', before, after);
  result.note =
    after && after.scrollY >= after.scrollMax
      ? 'Reached the bottom of the page.'
      : `Scroll position ${after?.scrollY ?? 'unknown'} of ${after?.scrollMax ?? 'unknown'}.`;
  return result;
}

export async function scrollToElement(locator: TargetLocator): Promise<ActionResult> {
  const el = resolveLocator(locator);
  const before = beforeFingerprint();
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  highlight(el, 900);
  const after = await afterFingerprint(180);
  return actionResult('scrollTo', before, after, describeElement(el, { ref: registry.refFor(el) }));
}

export interface TypeOptions {
  locator: TargetLocator;
  text: string;
  clearFirst: boolean;
}

function assertEditable(el: Element): asserts el is HTMLElement {
  const tag = el.tagName.toLowerCase();
  const editable =
    tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable === true;
  if (!editable) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'The target is not a text field.', {
      hint: 'Use click_element for buttons and links, or find_element to locate a textbox.',
      retryable: false,
    });
  }
  if (isSensitiveElement(el)) {
    throw new ToolError(
      ERROR_CODES.SENSITIVE_FIELD,
      'This field is classified as sensitive (password, OTP, or payment data).',
      {
        hint: 'Ask the user to fill it themselves. The agent must never read or write it.',
        retryable: false,
      },
    );
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function emitInput(el: Element, data: string): void {
  try {
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data,
      }),
    );
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function typeText(options: TypeOptions): Promise<ActionResult> {
  const el = resolveLocator(options.locator);
  assertEditable(el);
  const before = beforeFingerprint();
  const target = describeElement(el, { ref: registry.refFor(el) });

  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
  await sleep(30);

  const text = options.text.slice(0, 4_000);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const next = options.clearFirst ? text : `${el.value}${text}`;
    if (options.clearFirst) {
      el.select();
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        /* some input types do not support selection */
      }
    }
    setNativeValue(el, next);
    emitInput(el, text);
  } else {
    // contenteditable
    if (options.clearFirst) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    let inserted: boolean;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      if (options.clearFirst) el.textContent = text;
      else el.textContent = `${el.textContent ?? ''}${text}`;
      emitInput(el, text);
    }
  }

  const after = await afterFingerprint(160);
  const note =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? `Field now contains ${el.value.length} character(s).`
      : 'Editable content updated.';
  return actionResult('type', before, after, target, note);
}

export async function clearInput(locator: TargetLocator): Promise<ActionResult> {
  return typeText({ locator, text: '', clearFirst: true });
}

export async function selectDropdown(
  locator: TargetLocator,
  option: string,
): Promise<ActionResult> {
  const el = resolveLocator(locator);
  if (!(el instanceof HTMLSelectElement)) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'The target is not a native <select>.', {
      hint: 'For custom dropdowns, click the control and then click the option by text.',
      retryable: false,
    });
  }
  const needle = option.trim().toLowerCase();
  const match = Array.from(el.options).find(
    (candidate) =>
      candidate.text.trim().toLowerCase() === needle ||
      candidate.value.trim().toLowerCase() === needle,
  );
  if (!match) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, `No option matched "${option.slice(0, 80)}".`, {
      hint: `Available options: ${Array.from(el.options)
        .slice(0, 12)
        .map((o) => o.text.trim())
        .join(' · ')}`,
      retryable: false,
    });
  }
  const before = beforeFingerprint();
  el.value = match.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  const after = await afterFingerprint(160);
  return actionResult(
    'select',
    before,
    after,
    describeElement(el, { ref: registry.refFor(el) }),
    `Selected "${match.text.trim()}".`,
  );
}

export async function setCheckbox(locator: TargetLocator, checked: boolean): Promise<ActionResult> {
  const el = resolveLocator(locator) as HTMLInputElement;
  if (!(el instanceof HTMLInputElement) || (el.type !== 'checkbox' && el.type !== 'radio')) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'The target is not a checkbox or radio.', {
      hint: 'Use click_element for switches implemented as buttons.',
      retryable: false,
    });
  }
  const before = beforeFingerprint();
  const target = describeElement(el, { ref: registry.refFor(el) });
  if (el.checked === checked) {
    return actionResult(
      'checkbox',
      before,
      fingerprint(),
      target,
      'Already in the requested state.',
    );
  }
  if (el.type === 'radio' && !checked) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'A radio button cannot be unchecked directly.', {
      hint: 'Select another radio option in the same group instead.',
      retryable: false,
    });
  }
  ensureActionable(el);
  el.click();
  const after = await afterFingerprint(160);
  return actionResult(
    'checkbox',
    before,
    after,
    target,
    `Control is now ${el.checked ? 'checked' : 'unchecked'}.`,
  );
}

function keyEvent(el: Element, type: string, key: string): boolean {
  const event = new KeyboardEvent(type, {
    key,
    code: key === ' ' ? 'Space' : key,
    bubbles: true,
    composed: true,
    cancelable: true,
    view: window,
  });
  return el.dispatchEvent(event);
}

export async function pressKey(
  locator: TargetLocator | undefined,
  key: string,
): Promise<ActionResult> {
  const normalized = key.trim();
  if (!normalized) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'A key name is required.', {
      hint: 'Examples: Enter, Escape, Tab, ArrowDown.',
      retryable: false,
    });
  }
  if (normalized.length > 20) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'Key name is too long.', { retryable: false });
  }
  const el = locator ? resolveLocator(locator) : (document.activeElement ?? document.body);
  if (!el) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'Nothing is focused.', {
      hint: 'Focus a field first with focus_element.',
      retryable: true,
    });
  }
  const before = beforeFingerprint();
  const target = describeElement(el, { ref: registry.refFor(el) });
  if (el instanceof HTMLElement) {
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  const allowed = keyEvent(el, 'keydown', normalized);
  keyEvent(el, 'keypress', normalized);
  keyEvent(el, 'keyup', normalized);

  let note = `Pressed ${normalized}.`;
  const tag = el.tagName.toLowerCase();
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (allowed && normalized === 'Enter' && form && tag !== 'textarea') {
    const submitter = form.querySelector<HTMLElement>(
      'button[type="submit"],input[type="submit"],button:not([type])',
    );
    form.requestSubmit(submitter ?? undefined);
    note = 'Pressed Enter and submitted the containing form.';
  } else if (allowed && normalized === 'Tab') {
    const pool = collectInteractive(document, 400);
    const currentIndex = pool.indexOf(el);
    const next = pool.length > 0 ? pool[(currentIndex + 1 + pool.length) % pool.length] : undefined;
    if (next && next !== el && next instanceof HTMLElement) {
      next.focus();
      note = `Pressed Tab; focus moved to "${accessibleName(next).slice(0, 60)}".`;
    }
  } else if (
    allowed &&
    (normalized === 'ArrowDown' || normalized === 'ArrowUp') &&
    el instanceof HTMLSelectElement
  ) {
    const delta = normalized === 'ArrowDown' ? 1 : -1;
    const nextIndex = Math.min(
      Math.max(el.selectedIndex + delta, 0),
      Math.max(el.options.length - 1, 0),
    );
    el.selectedIndex = nextIndex;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    note = `Selected "${el.options[nextIndex]?.text.trim() ?? ''}".`;
  } else if (allowed && normalized === ' ' && el instanceof HTMLElement) {
    const clickable = el.closest<HTMLElement>('button,[role="button"],input[type="checkbox"]');
    if (clickable) clickable.click();
  }

  const after = await afterFingerprint(220);
  return actionResult('pressKey', before, after, target, note);
}

export async function focusElement(locator: TargetLocator): Promise<ActionResult> {
  const el = resolveLocator(locator);
  ensureActionable(el);
  const before = beforeFingerprint();
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const active = document.activeElement;
  const after = await afterFingerprint(120);
  return actionResult(
    'focus',
    before,
    after,
    describeElement(el, { ref: registry.refFor(el) }),
    active === el
      ? 'Element received focus.'
      : `Focus landed on ${active?.tagName.toLowerCase() ?? 'nothing'}; the page may manage focus itself.`,
  );
}

export async function waitForElement(
  locator: TargetLocator,
  timeoutMs: number,
): Promise<ActionResult> {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 500), 20_000);
  const before = beforeFingerprint();
  while (Date.now() < deadline) {
    const candidates = findCandidates(locator);
    const visible = candidates.find((candidate) => isVisible(candidate.element));
    if (visible) {
      highlight(visible.element, 900);
      return actionResult(
        'waitForElement',
        before,
        fingerprint(),
        describeElement(visible.element, { ref: registry.refFor(visible.element) }),
        'Element appeared.',
      );
    }
    await sleep(150);
  }
  throw new ToolError(ERROR_CODES.TIMEOUT, 'The element did not appear before the timeout.', {
    hint: 'Re-read the page and confirm the expected text or control exists.',
    retryable: true,
  });
}

export async function waitForText(text: string, timeoutMs: number): Promise<ActionResult> {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'Text to wait for is empty.', {
      retryable: false,
    });
  }
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 500), 20_000);
  const before = beforeFingerprint();
  while (Date.now() < deadline) {
    const bodyText = (document.body?.innerText ?? '').toLowerCase();
    if (bodyText.includes(needle)) {
      return actionResult('waitForText', before, fingerprint(), undefined, 'Text appeared.');
    }
    await sleep(150);
  }
  throw new ToolError(ERROR_CODES.TIMEOUT, `"${text.slice(0, 80)}" did not appear in time.`, {
    hint: 'Re-read the page; the text may be phrased differently or inside a frame.',
    retryable: true,
  });
}

export async function submitForm(locator: TargetLocator): Promise<ActionResult> {
  const el = resolveLocator(locator);
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'No form contains the target element.', {
      hint: 'Use click_element on the button that submits the form.',
      retryable: false,
    });
  }
  const before = beforeFingerprint();
  const submitter =
    form.querySelector<HTMLElement>(
      'button[type="submit"],input[type="submit"],button:not([type])',
    ) ?? undefined;
  try {
    form.requestSubmit(submitter ?? undefined);
  } catch (error) {
    throw new ToolError(
      ERROR_CODES.INVALID_ARGS,
      `The form refused submission: ${(error as Error).message.slice(0, 160)}`,
      { hint: 'Check required fields and validation messages.', retryable: true },
    );
  }
  const after = await afterFingerprint(400);
  return actionResult(
    'submit',
    before,
    after,
    describeElement(el, { ref: registry.refFor(el) }),
    'Form submission triggered.',
  );
}

export function inspectElement(el: Element): InspectionResult {
  const target = describeElement(el, { ref: registry.refFor(el) });
  const form = inspectFormContext(el);
  const submitControl = form.submitControl
    ? describeElement(form.submitControl, { ref: registry.refFor(form.submitControl) })
    : undefined;
  const riskText = [
    target.name,
    target.value,
    target.context,
    form.formText,
    (el as HTMLElement).innerText,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
  return {
    target,
    riskText,
    inForm: form.inForm,
    ...(form.formAction ? { formAction: form.formAction } : {}),
    ...(submitControl ? { submitControl } : {}),
    isSubmitLike: form.isSubmitLike,
  };
}

export function inspectTarget(locator: TargetLocator): InspectionResult {
  return inspectElement(resolveLocator(locator));
}

export function inspectPoint(x: number, y: number): InspectionResult {
  const el = interactiveAtPoint(x, y);
  if (!el) {
    throw new ToolError(ERROR_CODES.ELEMENT_NOT_FOUND, 'No element exists at those coordinates.', {
      hint: 'Capture a fresh screenshot and choose a point inside a control.',
      retryable: true,
    });
  }
  return inspectElement(el);
}

/**
 * Google Images has changed its DOM many times. Instead of a brittle selector,
 * find visible anchors that wrap a reasonably sized image and rank them by
 * position inside the main result area.
 */
export async function openImageResult(index: number): Promise<ActionResult> {
  const candidates: HTMLAnchorElement[] = [];
  const seen = new Set<string>();
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of anchors) {
    if (!isVisible(anchor)) continue;
    const image = anchor.querySelector('img');
    if (!image) continue;
    const rect = anchor.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 60) continue;
    if (rect.top < 80) continue; // skip the search bar and top navigation
    const key = `${anchor.href}|${Math.round(rect.x)}|${Math.round(rect.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(anchor);
  }
  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.top - br.top || ar.left - br.left;
  });
  const chosen = candidates[index];
  if (!chosen) {
    throw new ToolError(
      ERROR_CODES.ELEMENT_NOT_FOUND,
      `No image result at index ${index}. Found ${candidates.length} result(s).`,
      {
        hint: 'Call get_page_snapshot to see the image results currently on screen.',
        retryable: true,
      },
    );
  }
  const before = beforeFingerprint();
  const target = describeElement(chosen, { ref: registry.refFor(chosen) });
  chosen.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  await sleep(60);
  highlight(chosen, 900);
  const { x, y } = centerOf(chosen);
  if (hitTestMatches(chosen, x, y)) {
    dispatchPointer(chosen, 'pointerdown', x, y, 1);
    dispatchMouse(chosen, 'mousedown', x, y, 1);
    dispatchPointer(chosen, 'pointerup', x, y, 0);
    dispatchMouse(chosen, 'mouseup', x, y, 0);
  }
  chosen.click();
  const after = await afterFingerprint(500);
  return actionResult('openImageResult', before, after, target);
}

/** Role/label details for the visual-click approval sheet. */
export function describePoint(x: number, y: number): ElementSummary | undefined {
  const el = interactiveAtPoint(x, y);
  if (!el) return undefined;
  const summary = describeElement(el, { ref: registry.refFor(el) });
  if (!summary.role) summary.role = roleOf(el);
  return summary;
}
