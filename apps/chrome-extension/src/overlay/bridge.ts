/**
 * Overlay ↔ host & desktop window bridge.
 *
 * Implements smooth window dragging, view sizing, and lifecycle controls for
 * Option 1 (Native Desktop Companion / Out-of-Browser Sidecar HUD).
 */

export type OverlayView = 'pill' | 'panel' | 'expanded' | 'orb';

export type OverlayCommand =
  | { type: 'view'; view: OverlayView }
  | { type: 'close' }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'dragStart' }
  | { type: 'dragEnd' }
  | { type: 'ready' };

const SOURCE = 'gbl-overlay';
const LOCAL_HUD_POS_KEY = 'gbl_hud_pos';

export const isOverlay = (): boolean => document.documentElement.dataset.surface === 'overlay';

let dragWindowPos: { x: number; y: number } | null = null;
let dragRafId: number | null = null;
let pendingDx = 0;
let pendingDy = 0;
let cachedHudWindowId: number | null = null;
let isUpdatingPos = false;
let hasPendingUpdate = false;

function applyPosUpdate(left: number, top: number): void {
  if (typeof chrome === 'undefined' || !chrome.windows?.update) return;

  const doUpdate = (winId: number) => {
    if (isUpdatingPos) {
      hasPendingUpdate = true;
      return;
    }
    isUpdatingPos = true;
    chrome.windows
      .update(winId, { left, top })
      .then(() => {
        isUpdatingPos = false;
        if (hasPendingUpdate && dragWindowPos) {
          hasPendingUpdate = false;
          applyPosUpdate(Math.round(dragWindowPos.x), Math.round(dragWindowPos.y));
        }
      })
      .catch(() => {
        isUpdatingPos = false;
      });
  };

  if (cachedHudWindowId !== null) {
    doUpdate(cachedHudWindowId);
  } else if (chrome.windows.getCurrent) {
    chrome.windows.getCurrent((w) => {
      if (w?.id) {
        cachedHudWindowId = w.id;
        doUpdate(w.id);
      }
    });
  }
}

function flushDrag(): void {
  dragRafId = null;
  if (!dragWindowPos || (pendingDx === 0 && pendingDy === 0)) return;
  dragWindowPos.x += pendingDx;
  dragWindowPos.y += pendingDy;
  pendingDx = 0;
  pendingDy = 0;

  const targetX = Math.round(dragWindowPos.x);
  const targetY = Math.round(dragWindowPos.y);

  try {
    window.moveTo(targetX, targetY);
  } catch {
    /* ignore */
  }

  applyPosUpdate(targetX, targetY);
}

function post(command: OverlayCommand): void {
  if (!isOverlay()) return;
  try {
    window.parent.postMessage({ source: SOURCE, ...command }, '*');
  } catch {
    /* Parent went away (frame removed). Nothing to do. */
  }

  // Standalone desktop HUD window controls (Out-of-Browser Sidecar mode)
  if (typeof window !== 'undefined' && window.self === window.top) {
    if (command.type === 'dragStart') {
      dragWindowPos = { x: window.screenX, y: window.screenY };
      pendingDx = 0;
      pendingDy = 0;
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent) {
        chrome.windows.getCurrent((w) => {
          if (w?.id) cachedHudWindowId = w.id;
        });
      }
    } else if (command.type === 'drag') {
      if (!dragWindowPos) {
        dragWindowPos = { x: window.screenX, y: window.screenY };
      }
      pendingDx += command.dx;
      pendingDy += command.dy;
      if (dragRafId === null && typeof requestAnimationFrame === 'function') {
        dragRafId = requestAnimationFrame(flushDrag);
      } else if (typeof requestAnimationFrame !== 'function') {
        flushDrag();
      }
    } else if (command.type === 'dragEnd') {
      if (dragRafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      flushDrag();
      if (dragWindowPos && typeof chrome !== 'undefined' && chrome.storage?.local) {
        const finalLeft = Math.round(dragWindowPos.x);
        const finalTop = Math.round(dragWindowPos.y);
        chrome.storage.local
          .get([LOCAL_HUD_POS_KEY])
          .then((stored) => {
            const current = (stored?.[LOCAL_HUD_POS_KEY] as Record<string, unknown>) || {};
            chrome.storage.local
              .set({
                [LOCAL_HUD_POS_KEY]: {
                  ...current,
                  left: finalLeft,
                  top: finalTop,
                  width: typeof window !== 'undefined' ? window.outerWidth : current.width,
                  height: typeof window !== 'undefined' ? window.outerHeight : current.height,
                },
              })
              .catch(() => undefined);
          })
          .catch(() => undefined);
      }
      dragWindowPos = null;
    } else if (command.type === 'close') {
      try {
        window.close();
      } catch {
        /* ignore */
      }
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent && chrome.windows?.remove) {
        chrome.windows.getCurrent((w) => {
          if (w?.id) chrome.windows.remove(w.id).catch(() => undefined);
        });
      }
    } else if (command.type === 'view') {
      if (typeof chrome !== 'undefined' && chrome.windows?.getCurrent && chrome.windows?.update) {
        const targetWidth = command.view === 'expanded' ? 920 : 440;
        const targetHeight = command.view === 'expanded' ? 820 : 680;
        chrome.windows.getCurrent((w) => {
          if (w?.id) {
            cachedHudWindowId = w.id;
            const availW =
              typeof window !== 'undefined' && window.screen?.availWidth
                ? window.screen.availWidth
                : 1920;
            const availH =
              typeof window !== 'undefined' && window.screen?.availHeight
                ? window.screen.availHeight
                : 1080;
            let left = typeof w.left === 'number' ? w.left : 1000;
            let top = typeof w.top === 'number' ? w.top : 80;

            if (left + targetWidth > availW - 10) {
              left = Math.max(10, availW - targetWidth - 20);
            }
            if (top + targetHeight > availH - 10) {
              top = Math.max(10, availH - targetHeight - 20);
            }

            chrome.windows
              .update(w.id, {
                left,
                top,
                width: targetWidth,
                height: targetHeight,
              })
              .catch(() => undefined);

            chrome.storage?.local
              ?.set?.({
                [LOCAL_HUD_POS_KEY]: {
                  left,
                  top,
                  width: targetWidth,
                  height: targetHeight,
                },
              })
              .catch(() => undefined);
          }
        });
      }
    }
  }
}

export const overlay = {
  isOverlay,
  ready: () => post({ type: 'ready' }),
  setView: (view: OverlayView) => post({ type: 'view', view }),
  close: () => post({ type: 'close' }),
  drag: (dx: number, dy: number) => post({ type: 'drag', dx, dy }),
  dragStart: () => post({ type: 'dragStart' }),
  dragEnd: () => post({ type: 'dragEnd' }),
};

function isView(value: unknown): value is OverlayView {
  return value === 'pill' || value === 'panel' || value === 'expanded' || value === 'orb';
}

/** Host → overlay messages, validated by source and shape. */
export function onHostMessage(handler: (view: OverlayView) => void): () => void {
  if (!isOverlay()) return () => undefined;
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const data = event.data as { source?: string; type?: string; view?: unknown };
    if (!data || data.source !== 'gbl-host' || data.type !== 'state') return;
    if (!isView(data.view)) return;
    handler(data.view);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
