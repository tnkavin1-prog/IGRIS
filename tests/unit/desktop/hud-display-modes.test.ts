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

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal() as {
    screen: Record<string, unknown>;
    app: Record<string, unknown>;
    [key: string]: unknown;
  };
  const ipcMain = {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };

  class FakeBrowserWindow {
    webContents = { 
      on: vi.fn(), 
      send: vi.fn(), 
      isDestroyed: vi.fn(() => false),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(() => Promise.resolve('complete')),
      getURL: vi.fn(() => 'file:///hud/index.html'),
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
    getOpacity(): number {
      return 1;
    }
    setOpacity(_value: number): void {}
    setIgnoreMouseEvents(_ignore: boolean, _options?: { forward?: boolean }): void {}
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

  // Create a mock screen that is an EventEmitter
  const screenListeners = new Map<string, Set<Function>>();
  const mockScreen = {
    getPrimaryDisplay: () => ({
      workArea: { ...electronState.workArea },
      workAreaSize: {
        width: electronState.workArea.width,
        height: electronState.workArea.height,
      },
    }),
    getDisplayMatching: () => ({ workArea: { ...electronState.workArea } }),
    getAllDisplays: () => [{ workArea: { ...electronState.workArea } }],
    on: vi.fn((event: string, listener: Function) => {
      if (!screenListeners.has(event)) screenListeners.set(event, new Set());
      screenListeners.get(event)!.add(listener);
    }),
    off: vi.fn((event: string, listener: Function) => {
      screenListeners.get(event)?.delete(listener);
    }),
    once: vi.fn((event: string, listener: Function) => {
      const onceWrapper = (...args: unknown[]) => {
        listener(...args);
        mockScreen.off(event, onceWrapper);
      };
      mockScreen.on(event, onceWrapper);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      screenListeners.get(event)?.forEach(l => l(...args));
    }),
    // Expose the actual screen properties from electron
    ...actual.screen,
  };

  return {
    ...actual,
    BrowserWindow: FakeBrowserWindow,
    screen: mockScreen,
    ipcMain: {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },
    powerMonitor: {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
    },
    systemPreferences: {
      getAnimationSettings: vi.fn(() => ({ shouldRenderRichAnimation: true })),
    },
    app: {
      ...actual.app,
      getPath: vi.fn(() => '/tmp'),
      on: vi.fn(),
      once: vi.fn(),
    },
  };
});

describe('HUD display modes', () => {
  let createMainWindow: typeof import('../../../apps/desktop-hud/src/main/window.js').createMainWindow;
  let ensureWindowVisible: typeof import('../../../apps/desktop-hud/src/main/window.js').ensureWindowVisible;
  let getDisplayMode: typeof import('../../../apps/desktop-hud/src/main/window.js').getDisplayMode;
  let setDisplayMode: typeof import('../../../apps/desktop-hud/src/main/window.js').setDisplayMode;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    electronState.bounds = { x: 1400, y: 300, width: 420, height: 62 };
    electronState.setBoundsCalls = [];
    electronState.minimumSizes = [];
    electronState.resizable = [];
    electronState.maximizable = [];
    const mod = await import('../../../apps/desktop-hud/src/main/window.js');
    createMainWindow = mod.createMainWindow;
    ensureWindowVisible = mod.ensureWindowVisible;
    getDisplayMode = mod.getDisplayMode;
    setDisplayMode = mod.setDisplayMode;
  });

  // Use try/finally for cleanup instead of afterEach
  const cleanup = () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  };

  it('resizes the window to the orb footprint and keeps the right edge', () => {
    createMainWindow('preload.js', 'index.html');
    const before = electronState.bounds;

    expect(setDisplayMode('orb')).toBe('orb');
    expect(getDisplayMode()).toBe('orb');
    vi.runAllTimers();

    const call = electronState.setBoundsCalls.at(-1)!;
    // Orb preset (74) + shadow gutter (32) = 106
    expect(call.width).toBe(106);
    expect(call.height).toBe(106);
    // The right edge stays where it was, so the HUD never jumps.
    expect(call.x + call.width).toBe(before.x + before.width);
  });

  it('resizes the window to the bar footprint', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('bar');
    vi.runAllTimers();
    const call = electronState.setBoundsCalls.at(-1)!;
    // Bar preset (420) + shadow gutter (32) = 452
    expect(call.width).toBe(452);
    expect(call.height).toBe(94);
  });

  it('resizes the window to the full panel footprint', () => {
    createMainWindow('preload.js', 'index.html');
    // Window starts in 'full' mode; switch away and back to trigger resize
    setDisplayMode('bar');
    vi.runAllTimers();

    setDisplayMode('full');
    vi.runAllTimers();
    const call = electronState.setBoundsCalls.at(-1)!;
    // Full preset (400x600) + shadow gutter (32) = 432x632
    expect(call.width).toBe(432);
    expect(call.height).toBe(632);
  });

  it('restores the previous full size when the console is reopened', () => {
    createMainWindow('preload.js', 'index.html');

    setDisplayMode('console');
    vi.runAllTimers();
    const consoleCall = electronState.setBoundsCalls.at(-1)!;
    // Console uses its own preset (540) + shadow gutter (32) = 572 on first entry
    expect(consoleCall.width).toBe(572);
    expect(consoleCall.height).toBe(732);

    // Leaving the console remembers the size so the next open is identical.
    setDisplayMode('bar');
    vi.runAllTimers();
    setDisplayMode('console');
    vi.runAllTimers();
    const reopened = electronState.setBoundsCalls.at(-1)!;
    expect(reopened.width).toBe(consoleCall.width);
    expect(reopened.height).toBe(consoleCall.height);
  });

  it('falls back to the bar for an unknown mode', () => {
    createMainWindow('preload.js', 'index.html');

    expect(setDisplayMode('nonsense' as never)).toBe('bar');
    expect(getDisplayMode()).toBe('bar');
    vi.runAllTimers();
  });

  it('keeps the window inside the work area of the current display', () => {
    createMainWindow('preload.js', 'index.html');
    // The HUD sits near the left edge, so a wide mode must be pulled back.
    electronState.bounds = { x: 10, y: 10, width: 420, height: 62 };

    setDisplayMode('console');
    vi.runAllTimers();
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
    setDisplayMode('bar');
    // Bar mode size: 420 + 32 gutter = 452 x 94
    electronState.bounds = { x: 1200, y: 200, width: 452, height: 94 };
    electronState.setBoundsCalls = [];

    expect(ensureWindowVisible()).toBe(false);
    expect(electronState.setBoundsCalls).toHaveLength(0);
  });
});
