/**
 * Modal focus management.
 *
 * A dialog that renders over the panel must do three things for keyboard and
 * screen-reader users:
 *   1. move focus inside when it opens,
 *   2. keep Tab / Shift+Tab cycling within it,
 *   3. return focus to the control that opened it when it closes.
 *
 * The page behind a modal is visually covered but still in the tab order, so
 * the trap is not cosmetic: without it, Tab silently escapes into controls the
 * user cannot see.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableInside(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      element.getClientRects().length > 0,
  );
}

/**
 * Open dialogs, ordered by visual layer. Only the topmost dialog may trap
 * focus. Without this, a settings panel opened from onboarding (or an approval
 * sheet appearing over settings) would fight the dialog beneath it for focus.
 */
interface StackEntry {
  dialog: HTMLElement;
  layer: number;
  sequence: number;
}

const dialogStack: StackEntry[] = [];
let dialogSequence = 0;

function isTopmost(dialog: HTMLElement): boolean {
  let top: StackEntry | undefined;
  for (const entry of dialogStack) {
    if (!entry.dialog.isConnected) continue;
    if (
      !top ||
      entry.layer > top.layer ||
      (entry.layer === top.layer && entry.sequence > top.sequence)
    ) {
      top = entry;
    }
  }
  return top?.dialog === dialog;
}

export interface DialogFocusOptions {
  /** Called for Escape. The caller decides whether closing is allowed. */
  onEscape?: (() => void) | undefined;
  /** Element to focus on open. Defaults to the first focusable descendant. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Visual layer, matching the dialog's z-index. Higher layers win focus. */
  layer?: number | undefined;
}

/**
 * Returns the ref to attach to the element carrying `role="dialog"`. The
 * element must be focusable (`tabIndex={-1}`) so it can receive focus when it
 * contains no controls yet.
 */
export function useDialogFocus<T extends HTMLElement>(
  options: DialogFocusOptions = {},
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Keep the latest callback without re-running the effect on every render.
  // The refs are initialised with the first values and synced in an effect so
  // no ref is written during render.
  const escapeRef = useRef(options.onEscape);
  const initialRef = useRef(options.initialFocus);
  const layerRef = useRef(options.layer ?? 0);
  useEffect(() => {
    escapeRef.current = options.onEscape;
    initialRef.current = options.initialFocus;
    layerRef.current = options.layer ?? 0;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const entry: StackEntry = {
      dialog,
      layer: layerRef.current,
      sequence: (dialogSequence += 1),
    };
    dialogStack.push(entry);

    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement && active !== document.body ? active : null;

    if (isTopmost(dialog)) {
      const preferred = initialRef.current?.current;
      const target = preferred ?? focusableInside(dialog)[0] ?? dialog;
      target.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopmost(dialog)) return;
      if (event.key === 'Escape') {
        const handler = escapeRef.current;
        if (handler) {
          event.preventDefault();
          event.stopPropagation();
          handler();
        }
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusableInside(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      const outside = !(current instanceof Node) || !dialog.contains(current);

      if (event.shiftKey && (current === first || current === dialog || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    // A programmatic focus() on the page behind the modal must not strand the
    // user outside the dialog.
    const onFocusIn = (event: FocusEvent): void => {
      if (!isTopmost(dialog)) return;
      if (!(event.target instanceof Node) || dialog.contains(event.target)) return;
      const fallback = focusableInside(dialog)[0] ?? dialog;
      fallback.focus();
    };

    dialog.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const index = dialogStack.indexOf(entry);
      if (index >= 0) dialogStack.splice(index, 1);
      const restore = restoreRef.current;
      restoreRef.current = null;
      // The opener can disappear while the dialog is open (for example a menu
      // item that re-renders). Only restore if it is still in the document.
      if (restore?.isConnected) restore.focus();
    };
  }, []);

  return dialogRef;
}
