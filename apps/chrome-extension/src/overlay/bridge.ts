/**
 * Overlay ↔ host bridge.
 *
 * The overlay runs inside a chrome-extension:// iframe. The host is a content
 * script in the page, which owns the frame's geometry (the iframe cannot style
 * itself outside its own box). Only geometry and lifecycle travel this channel —
 * never conversation text, never the gate secret.
 */

export type OverlayCommand =
  | { type: 'collapse'; collapsed: boolean }
  | { type: 'close' }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'ready' };

const SOURCE = 'gbl-overlay';

export const isOverlay = (): boolean => document.documentElement.dataset.surface === 'overlay';

function post(command: OverlayCommand): void {
  if (!isOverlay()) return;
  try {
    window.parent.postMessage({ source: SOURCE, ...command }, '*');
  } catch {
    /* Parent went away (frame removed). Nothing to do. */
  }
}

export const overlay = {
  isOverlay,
  ready: () => post({ type: 'ready' }),
  setCollapsed: (collapsed: boolean) => post({ type: 'collapse', collapsed }),
  close: () => post({ type: 'close' }),
  drag: (dx: number, dy: number) => post({ type: 'drag', dx, dy }),
};

/** Host → overlay messages, validated by source and shape. */
export function onHostMessage(handler: (collapsed: boolean) => void): () => void {
  if (!isOverlay()) return () => undefined;
  const listener = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const data = event.data as { source?: string; type?: string; collapsed?: unknown };
    if (!data || data.source !== 'gbl-host' || data.type !== 'state') return;
    handler(data.collapsed === true);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
