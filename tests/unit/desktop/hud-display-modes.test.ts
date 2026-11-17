import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
    webContents = {
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
    };

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
    isVisible(): boolean {
      return true;
    }
    isFocused(): boolean {
      return false;
    }
    getOpacity(): number {
      return 1;
    }
    setOpacity(): void {}
    setIgnoreMouseEvents(): void {}
    setSkipTaskbar(): void {}
    hide(): void {}
    unmaximize(): void {}
    maximize(): void {}
    restore(): void {}
    moveTop(): void {}
    show(): void {}
    focus(): void {}
    loadFile(): Promise<void> { return Promise.resolve(); }

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
        workArea: { ...electronState.workArea },
        workAreaSize: {
          width: electronState.workArea.width,
          height: electronState.workArea.height,
        },
        scaleFactor: 1,
      }),
      getAllDisplays: () => [
        { workArea: { ...electronState.workArea }, scaleFactor: 1 },
      ],
      getDisplayMatching: () => ({ workArea: { ...electronState.workArea }, scaleFactor: 1 }),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
    app: { once: vi.fn(), getPath: () => 'temp/hud-display-mode-test' },
    systemPreferences: { getAnimationSettings: () => ({ shouldRenderRichAnimation: false }) },
    ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn() },
  };
});

import {
  createMainWindow,
  ensureWindowVisible,
  getDisplayMode,
  setDisplayMode,
} from '../../../apps/desktop-hud/src/main/window.js';

describe('HUD display modes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    electronState.bounds = { x: 1400, y: 300, width: 420, height: 62 };
    electronState.setBoundsCalls = [];
    electronState.minimumSizes = [];
    electronState.resizable = [];
    electronState.maximizable = [];
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('resizes the window to the orb footprint and keeps the right edge', () => {
    createMainWindow('preload.js', 'index.html');
    const before = electronState.bounds;

    expect(setDisplayMode('orb')).toBe('orb');
    vi.advanceTimersByTime(0);
    expect(getDisplayMode()).toBe('orb');

    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(106);
    expect(call.height).toBe(106);
    // The right edge stays where it was, so the HUD never jumps.
    expect(call.x + call.width).toBe(before.x + before.width);
  });

  it('resizes the window to the bar footprint', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('bar');
    vi.advanceTimersByTime(0);
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(452);
    expect(call.height).toBe(94);
  });

  it('resizes the window to the full panel footprint', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('full');
    vi.advanceTimersByTime(0);
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.width).toBe(432);
    expect(call.height).toBe(632);
  });

  it('restores the previous full size when the console is reopened', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('console');
    vi.advanceTimersByTime(0);
    const consoleCall = electronState.setBoundsCalls.at(-1)!;
    expect(consoleCall.width).toBe(572);
    expect(consoleCall.height).toBe(732);

    // Leaving the console remembers the size so the next open is identical.
    setDisplayMode('bar');
    vi.advanceTimersByTime(0);
    setDisplayMode('console');
    vi.advanceTimersByTime(0);
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
    vi.advanceTimersByTime(0);
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

  it('recenters a stranded window when the HUD is summoned', () => {
    createMainWindow('preload.js', 'index.html');
    electronState.bounds = { x: 5000, y: 5000, width: 74, height: 74 };
    electronState.setBoundsCalls = [];

    expect(ensureWindowVisible()).toBe(true);
    const call = electronState.setBoundsCalls.at(-1)!;
    expect(call.x).toBeGreaterThanOrEqual(electronState.workArea.x);
    expect(call.y).toBeGreaterThanOrEqual(electronState.workArea.y);
    expect(call.x + call.width).toBeLessThanOrEqual(
      electronState.workArea.x + electronState.workArea.width,
    );
    expect(call.y + call.height).toBeLessThanOrEqual(
      electronState.workArea.y + electronState.workArea.height,
    );
  });

  it('does not move a window that is already fully visible', () => {
    createMainWindow('preload.js', 'index.html');
    electronState.bounds = { x: 1200, y: 200, width: 420, height: 62 };
    electronState.setBoundsCalls = [];

    expect(ensureWindowVisible()).toBe(false);
    expect(electronState.setBoundsCalls).toHaveLength(0);
  });
});
