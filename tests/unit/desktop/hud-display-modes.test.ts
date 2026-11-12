import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Display-mode geometry for the desktop HUD window.
 *
 * The HUD is an always-on-top surface, so the window must resize to the
 * active mode, keep its right edge anchored and never leave the work area
 * of the display it currently sits on.
 */

const electronState = vi.hoisted(() => {
  const state = {
    bounds: { x: 1400, y: 300, width: 420, height: 62 },
    setBoundsCalls: [] as Array<{ x: number; y: number; width: number; height: number }>,
    minimumSizes: [] as Array<{ width: number; height: number }>,
    resizable: [] as boolean[],
    maximizable: [] as boolean[],
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  return state;
});

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents = { on: vi.fn(), send: vi.fn() };

    constructor(public readonly options: Record<string, unknown> = {}) {}

    on(): void {}
    once(): void {}
    setAlwaysOnTop(): void {}
    isMaximized(): boolean {
      return false;
    }
    isMinimized(): boolean {
      return false;
    }
    isDestroyed(): boolean {
      return false;
    }
    unmaximize(): void {}
    maximize(): void {}
    restore(): void {}
    moveTop(): void {}
    show(): void {}
    focus(): void {}
    loadFile(): void {}

    getBounds() {
      return { ...electronState.bounds };
    }

    setBounds(next: { x: number; y: number; width: number; height: number }): void {
      electronState.setBoundsCalls.push({ ...next });
      electronState.bounds = { ...next };
    }

    setMinimumSize(width: number, height: number): void {
      electronState.minimumSizes.push({ width, height });
    }

    setResizable(value: boolean): void {
      electronState.resizable.push(value);
    }

    setMaximizable(value: boolean): void {
      electronState.maximizable.push(value);
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: {
          width: electronState.workArea.width,
          height: electronState.workArea.height,
        },
      }),
      getDisplayMatching: () => ({ workArea: { ...electronState.workArea } }),
    },
  };
});

import {
  createMainWindow,
  getDisplayMode,
  setDisplayMode,
} from '../../../apps/desktop-hud/src/main/window.js';

describe('HUD display modes', () => {
  beforeEach(() => {
    electronState.bounds = { x: 1400, y: 300, width: 420, height: 62 };
    electronState.setBoundsCalls = [];
    electronState.minimumSizes = [];
    electronState.resizable = [];
    electronState.maximizable = [];
  });

  it('resizes the window to the orb footprint and keeps the right edge', () => {
    createMainWindow('preload.js', 'index.html');
    const before = electronState.bounds;

    expect(setDisplayMode('orb')).toBe('orb');
    expect(getDisplayMode()).toBe('orb');

    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(74);
    expect(call.height).toBe(74);
    // The right edge stays where it was, so the HUD never jumps.
    expect(call.x + call.width).toBe(before.x + before.width);
    expect(electronState.minimumSizes.at(-1)).toEqual({ width: 74, height: 74 });
    expect(electronState.resizable.at(-1)).toBe(false);
  });

  it('resizes the window to the bar footprint', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('bar');
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(420);
    expect(call.height).toBe(62);
    expect(electronState.minimumSizes.at(-1)).toEqual({ width: 420, height: 62 });
  });

  it('resizes the window to the full panel footprint', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('full');
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(400);
    expect(call.height).toBe(600);
    expect(electronState.minimumSizes.at(-1)).toEqual({ width: 400, height: 600 });
  });

  it('restores the previous full size when the console is reopened', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('console');
    const consoleCall = electronState.setBoundsCalls.at(-1)!;
    expect(consoleCall.width).toBe(540);
    expect(consoleCall.height).toBe(700);
    expect(electronState.resizable.at(-1)).toBe(true);
    expect(electronState.maximizable.at(-1)).toBe(true);

    // Leaving the console remembers the size so the next open is identical.
    setDisplayMode('bar');
    setDisplayMode('console');
    const reopened = electronState.setBoundsCalls.at(-1)!;
    expect(reopened.width).toBe(consoleCall.width);
    expect(reopened.height).toBe(consoleCall.height);
  });

  it('falls back to the bar for an unknown mode', () => {
    createMainWindow('preload.js', 'index.html');

    expect(setDisplayMode('nonsense' as never)).toBe('bar');
    expect(getDisplayMode()).toBe('bar');
  });

  it('keeps the window inside the work area of the current display', () => {
    createMainWindow('preload.js', 'index.html');
    // The HUD sits near the left edge, so a wide mode must be pulled back.
    electronState.bounds = { x: 10, y: 10, width: 420, height: 62 };

    setDisplayMode('console');
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.x).toBeGreaterThanOrEqual(electronState.workArea.x);
    expect(call.x + call.width).toBeLessThanOrEqual(
      electronState.workArea.x + electronState.workArea.width,
    );
    expect(call.y).toBeGreaterThanOrEqual(electronState.workArea.y);
    expect(call.y + call.height).toBeLessThanOrEqual(
      electronState.workArea.y + electronState.workArea.height,
    );
  });
});
