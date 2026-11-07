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

  it('posts view changes for all three surfaces', () => {
    overlay.setView('pill');
    overlay.setView('panel');
    overlay.setView('orb');
    expect(posted).toEqual([
      { source: 'gbl-overlay', type: 'view', view: 'pill' },
      { source: 'gbl-overlay', type: 'view', view: 'panel' },
      { source: 'gbl-overlay', type: 'view', view: 'orb' },
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
    overlay.setView('panel');
    overlay.drag(1, 1);
    expect(posted).toEqual([]);
  });

  it('delivers host state only from the parent with a known view', () => {
    const seen: string[] = [];
    const stop = onHostMessage((view) => seen.push(view));

    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'pill' },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'panel' },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'orb' },
      }),
    );
    // Wrong source (a foreign window), wrong type, unknown view, and junk
    // payloads are ignored.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: {} as unknown as Window,
        data: { source: 'gbl-host', type: 'state', view: 'panel' },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-overlay', type: 'state', view: 'panel' },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'fullscreen' },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state' },
      }),
    );
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: null }));

    expect(seen).toEqual(['pill', 'panel', 'orb']);

    stop();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'panel' },
      }),
    );
    expect(seen).toEqual(['pill', 'panel', 'orb']);
  });

  it('is a no-op on the side panel surface', () => {
    setSurface(null);
    const handler = vi.fn();
    const stop = onHostMessage(handler);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'gbl-host', type: 'state', view: 'panel' },
      }),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
