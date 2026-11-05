// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOverlay,
  onHostMessage,
  overlay,
} from '../../../apps/chrome-extension/src/overlay/bridge.js';

function setSurface(value: string | null): void {
  if (value === null) delete document.documentElement.dataset.surface;
  else document.documentElement.dataset.surface = value;
}

describe('overlay bridge', () => {
  let posted: unknown[];

  beforeEach(() => {
    posted = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((message: unknown): void => {
      posted.push(message);
    }) as typeof window.postMessage);
    setSurface('overlay');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setSurface(null);
  });

  it('detects the overlay surface from the document attribute', () => {
    expect(isOverlay()).toBe(true);
    setSurface('panel');
    expect(isOverlay()).toBe(false);
    setSurface(null);
    expect(isOverlay()).toBe(false);
  });

  it('posts a collapse command with the requested state', () => {
    overlay.setCollapsed(true);
    overlay.setCollapsed(false);
    expect(posted).toEqual([
      { source: 'gbl-overlay', type: 'collapse', collapsed: true },
      { source: 'gbl-overlay', type: 'collapse', collapsed: false },
    ]);
  });

  it('posts close and drag commands', () => {
    overlay.close();
    overlay.drag(12, -8);
    expect(posted).toEqual([
      { source: 'gbl-overlay', type: 'close' },
      { source: 'gbl-overlay', type: 'drag', dx: 12, dy: -8 },
    ]);
  });

  it('stays silent outside the overlay surface', () => {
    setSurface(null);
    overlay.close();
    overlay.setCollapsed(true);
    overlay.drag(1, 1);
    expect(posted).toEqual([]);
  });

  it('delivers host state only from the parent with the right shape', () => {
    const seen: boolean[] = [];
    const stop = onHostMessage((collapsed) => seen.push(collapsed));

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', collapsed: true },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', collapsed: false },
      }),
    );
    // Wrong source (a foreign window), wrong type, and junk payloads are ignored.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: {} as unknown as Window,
        data: { source: 'gbl-host', type: 'state', collapsed: true },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-overlay', type: 'state', collapsed: true },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'drag', dx: 5 },
      }),
    );
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: null }));

    expect(seen).toEqual([true, false]);

    stop();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', collapsed: true },
      }),
    );
    expect(seen).toEqual([true, false]);
  });

  it('is a no-op on the side panel surface', () => {
    setSurface(null);
    const handler = vi.fn();
    const stop = onHostMessage(handler);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', collapsed: true },
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
