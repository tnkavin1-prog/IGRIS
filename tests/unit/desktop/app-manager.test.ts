import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppManagerService } from '../../../apps/desktop-hud/src/main/app-manager.js';

describe('AppManagerService', () => {
  let appManager: AppManagerService;

  beforeEach(() => {
    appManager = new AppManagerService({ mockMode: true });
  });

  it('lists running desktop windows', async () => {
    const windows = await appManager.listRunningWindows();
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]?.title).toBeDefined();
    expect(windows[0]?.processName).toBeDefined();
  });

  it('launches application with alias resolution', async () => {
    const res = await appManager.launchApplication('notepad');
    expect(res.ok).toBe(true);
    expect(res.appName).toBe('notepad');
    expect(res.pid).toBeGreaterThan(0);

    const windows = await appManager.listRunningWindows();
    const launched = windows.find((w) => w.title.includes('notepad'));
    expect(launched).toBeDefined();
  });

  it('routes a browser through the gateway even when a memory alias exists', async () => {
    // The default memory store maps "chrome" to a bare "chrome.exe" that is
    // not on PATH. That alias must never shadow the browser gateway.
    const memoryStore = {
      getAlias: (name: string) =>
        name === 'chrome' ? { alias: 'chrome', targetApp: 'chrome.exe', useCount: 1 } : undefined,
      recordAliasUsage: vi.fn(),
    };
    appManager.setMemoryStore(memoryStore as never);

    const gateway = {
      focusOrLaunch: vi.fn().mockResolvedValue({ success: true, windowTitle: 'Google Chrome' }),
      openTab: vi.fn().mockResolvedValue({ success: true, windowTitle: 'Google Chrome' }),
    };
    appManager.setBrowserGateway(gateway as never);

    const res = await appManager.launchApplication('chrome');

    expect(gateway.focusOrLaunch).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
  });

  it('honours a memory alias that carries intent', async () => {
    const memoryStore = {
      getAlias: (name: string) =>
        name === 'chrome-dev'
          ? {
              alias: 'chrome-dev',
              targetApp: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              arguments: ['--profile-directory=Dev'],
              useCount: 1,
            }
          : undefined,
      recordAliasUsage: vi.fn(),
    };
    appManager.setMemoryStore(memoryStore as never);

    const gateway = {
      focusOrLaunch: vi.fn().mockResolvedValue({ success: true, windowTitle: 'Google Chrome' }),
      openTab: vi.fn(),
    };
    appManager.setBrowserGateway(gateway as never);

    const res = await appManager.launchApplication('chrome-dev');

    // An explicit alias wins over the gateway.
    expect(gateway.focusOrLaunch).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it('reports the real cause when the executable cannot be started', async () => {
    const real = new AppManagerService({ mockMode: false });
    // Skip the Start-Menu fallback so the test stays hermetic and fast.
    (real as unknown as { resolveStartApp: () => Promise<null> }).resolveStartApp = async () =>
      null;

    const res = await real.launchApplication('zzz-definitely-not-an-installed-app');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('not found');
    // The old behaviour burned ten seconds and blamed the window lookup.
    expect(res.error).not.toContain('no matching window appeared');
  });

  it('focuses, minimizes, maximizes, and closes windows', async () => {
    const focused = await appManager.focusWindow('Google Chrome');
    expect(focused).toBe(true);

    const minimized = await appManager.minimizeWindow('Google Chrome');
    expect(minimized).toBe(true);

    const maximized = await appManager.maximizeWindow('Google Chrome');
    expect(maximized).toBe(true);

    const closed = await appManager.closeWindow('Google Chrome');
    expect(closed).toBe(true);

    const windowsAfterClose = await appManager.listRunningWindows();
    expect(windowsAfterClose.find((w) => w.title === 'Google Chrome')).toBeUndefined();
  });

  it('executes safe system commands', async () => {
    const result = await appManager.runSystemCommand('Get-Date');
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Mock Command Output');
  });

  it('blocks catastrophic destructive commands with safety rule', async () => {
    const destructive = [
      'format C:',
      'diskpart',
      'rmdir /s /q C:\\',
      'del /f /q /s C:\\',
      'Stop-Computer',
      'shutdown -s -t 0',
      'Remove-Item -Recurse C:\\',
    ];

    for (const cmd of destructive) {
      const res = await appManager.runSystemCommand(cmd);
      expect(res.ok).toBe(false);
      expect(res.blocked).toBe(true);
      expect(res.stderr).toContain('blocked by safety policy');
    }
  });

  it('refuses a dangerous command until a human approves it', async () => {
    const res = await appManager.runSystemCommand('Remove-Item C:\\temp\\stale.txt');

    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('approval-required');
    expect(res.stderr).toContain('requires explicit approval');
  });

  it('runs a dangerous command once it is approved', async () => {
    const res = await appManager.runSystemCommand('Remove-Item C:\\temp\\stale.txt', {
      approved: true,
    });

    expect(res.ok).toBe(true);
    expect(res.blocked).toBeUndefined();
    expect(res.stdout).toContain('Mock Command Output');
  });

  it('never lets an approval unlock a blocked command', async () => {
    const res = await appManager.runSystemCommand('format C: /q', { approved: true });

    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.stderr).toContain('blocked by safety policy');
  });

  it('audits blocked, approval-gated and executed commands', async () => {
    const events: Array<{ event: string; details?: Record<string, unknown> }> = [];
    const audit = (event: string, details?: Record<string, unknown>) => {
      events.push({ event, details });
    };

    await appManager.runSystemCommand('format C: /q', { audit });
    await appManager.runSystemCommand('Remove-Item C:\\temp\\a.txt', { audit });
    await appManager.runSystemCommand('Remove-Item C:\\temp\\a.txt', { approved: true, audit });

    expect(events.map((entry) => entry.event)).toEqual([
      'command:blocked',
      'command:approval-required',
      'command:executed',
    ]);
    expect(events[1]?.details?.risk).toBe('dangerous');
    expect(events[2]?.details?.approved).toBe(true);
  });

  it('handles unknown window query gracefully without throwing', async () => {
    const focused = await appManager.focusWindow('Completely NonExistent App Window Title 9999');
    expect(focused).toBe(false);

    const minimized = await appManager.minimizeWindow(
      'Completely NonExistent App Window Title 9999',
    );
    expect(minimized).toBe(false);
  });

  describe('Window Tiling & Layout Orchestration', () => {
    it('retrieves default work area in mock mode', async () => {
      const wa = await appManager.getWorkArea();
      expect(wa.width).toBe(1920);
      expect(wa.height).toBe(1040);
    });

    it('moves and resizes window to exact coordinates', async () => {
      const ok = await appManager.moveWindow('Google Chrome', {
        x: 100,
        y: 150,
        width: 800,
        height: 600,
      });
      expect(ok).toBe(true);

      const windows = await appManager.listRunningWindows();
      const chrome = windows.find((w) => w.title === 'Google Chrome');
      expect(chrome?.bounds).toEqual({ x: 100, y: 150, width: 800, height: 600 });
    });

    it('tiles windows in side-by-side layout (Chrome left 50%, target right 50%)', async () => {
      const res = await appManager.tileWindows('side-by-side', { targetApp: 'notepad' });
      expect(res.success).toBe(true);
      expect(res.layout).toBe('side-by-side');
      expect(res.tiledWindows).toHaveLength(2);

      const left = res.tiledWindows[0]!;
      expect(left.title).toContain('Chrome');
      expect(left.bounds).toEqual({ x: 0, y: 0, width: 960, height: 1040 });

      const right = res.tiledWindows[1]!;
      expect(right.title.toLowerCase()).toContain('notepad');
      expect(right.bounds).toEqual({ x: 960, y: 0, width: 960, height: 1040 });
    });

    it('auto-launches target application if not already running for side-by-side tiling', async () => {
      const res = await appManager.tileWindows('side-by-side', { targetApp: 'calculator' });
      expect(res.success).toBe(true);
      expect(res.tiledWindows).toHaveLength(2);
      expect(res.tiledWindows[1]?.title.toLowerCase()).toContain('calc');
      expect(res.tiledWindows[1]?.bounds.x).toBe(960);
    });

    it('tiles window in maximize-target layout while HUD stays floating', async () => {
      const res = await appManager.tileWindows('maximize-target', { targetApp: 'Google Chrome' });
      expect(res.success).toBe(true);
      expect(res.layout).toBe('maximize-target');
      expect(res.tiledWindows).toHaveLength(1);
      expect(res.tiledWindows[0]?.title).toBe('Google Chrome');
      expect(res.tiledWindows[0]?.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    });

    it('tiles up to 4 active windows in a 2x2 multi-tasking grid', async () => {
      const res = await appManager.tileWindows('grid-2x2');
      expect(res.success).toBe(true);
      expect(res.layout).toBe('grid-2x2');
      expect(res.tiledWindows.length).toBeGreaterThanOrEqual(3);

      // Verify slot coordinates
      expect(res.tiledWindows[0]?.bounds).toEqual({ x: 0, y: 0, width: 960, height: 520 });
      expect(res.tiledWindows[1]?.bounds).toEqual({ x: 960, y: 0, width: 960, height: 520 });
      expect(res.tiledWindows[2]?.bounds).toEqual({ x: 0, y: 520, width: 960, height: 520 });
      if (res.tiledWindows[3]) {
        expect(res.tiledWindows[3]?.bounds).toEqual({ x: 960, y: 520, width: 960, height: 520 });
      }
    });

    it('tiles explicit list of window titles in grid-2x2 layout', async () => {
      const customTitles = ['Google Chrome', 'Visual Studio Code', 'Windows PowerShell'];
      const res = await appManager.tileWindows('grid-2x2', { windowTitles: customTitles });
      expect(res.success).toBe(true);
      expect(res.tiledWindows).toHaveLength(3);
      expect(res.tiledWindows[0]?.title).toBe('Google Chrome');
      expect(res.tiledWindows[1]?.title).toBe('Visual Studio Code');
      expect(res.tiledWindows[2]?.title).toBe('Windows PowerShell');
    });

    it('supports multi-monitor tiling on secondary display (monitorIndex: 1)', async () => {
      // 1. Check secondary workArea query
      const secondaryWorkArea = await appManager.getWorkArea(1);
      expect(secondaryWorkArea.x).toBe(1920);
      expect(secondaryWorkArea.width).toBe(1920);

      // 2. Tile side-by-side on secondary monitor
      const sideRes = await appManager.tileWindows('side-by-side', {
        monitorIndex: 1,
        targetApp: 'Calculator',
      });
      expect(sideRes.success).toBe(true);
      expect(sideRes.tiledWindows).toHaveLength(2);
      expect(sideRes.tiledWindows[0]?.bounds.x).toBe(1920);
      expect(sideRes.tiledWindows[1]?.bounds.x).toBe(2880);

      // 3. Maximize target on secondary monitor
      const maxRes = await appManager.tileWindows('maximize-target', {
        monitorIndex: 1,
        targetApp: 'Visual Studio Code',
      });
      expect(maxRes.success).toBe(true);
      expect(maxRes.tiledWindows[0]?.bounds.x).toBe(1920);

      // 4. Grid-2x2 on secondary monitor
      const gridRes = await appManager.tileWindows('grid-2x2', { monitorIndex: 1 });
      expect(gridRes.success).toBe(true);
      expect(gridRes.tiledWindows[0]?.bounds.x).toBe(1920);
      expect(gridRes.tiledWindows[1]?.bounds.x).toBe(2880);
    });

    it('resolves applications by alias and process mapping via resolveAppWindow', () => {
      const windows = [
        {
          hwnd: 101,
          title: 'Document1 - Word',
          processName: 'WINWORD',
          pid: 1,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 102,
          title: 'Calculator',
          processName: 'CalculatorApp',
          pid: 2,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 103,
          title: 'Microsoft Edge - PDF Reader',
          processName: 'msedge',
          pid: 3,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 104,
          title: 'Windows PowerShell',
          processName: 'powershell',
          pid: 4,
          isVisible: true,
          isIconic: false,
        },
      ];

      expect(appManager.resolveAppWindow('word', windows)?.processName).toBe('WINWORD');
      expect(appManager.resolveAppWindow('calc', windows)?.processName).toBe('CalculatorApp');
      expect(appManager.resolveAppWindow('calculator', windows)?.processName).toBe('CalculatorApp');
      expect(appManager.resolveAppWindow('pdf', windows)?.processName).toBe('msedge');
      expect(appManager.resolveAppWindow('terminal', windows)?.processName).toBe('powershell');
    });

    it('filters out Windows shell background windows from 2x2 grid tiling', async () => {
      const mockManager = new AppManagerService({ mockMode: true });
      (mockManager as any).simulatedWindows = [
        {
          hwnd: 901,
          title: 'Program Manager',
          processName: 'explorer',
          pid: 10,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 902,
          title: 'Windows Input Experience',
          processName: 'TextInputHost',
          pid: 11,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 903,
          title: 'Gemini Floating HUD',
          processName: 'electron',
          pid: 12,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 904,
          title: 'Google Chrome',
          processName: 'chrome',
          pid: 13,
          isVisible: true,
          isIconic: false,
        },
        {
          hwnd: 905,
          title: 'Visual Studio Code',
          processName: 'Code',
          pid: 14,
          isVisible: true,
          isIconic: false,
        },
      ];

      const res = await mockManager.tileWindows('grid-2x2');
      expect(res.success).toBe(true);
      const titles = res.tiledWindows.map((w) => w.title);
      expect(titles).not.toContain('Program Manager');
      expect(titles).not.toContain('Windows Input Experience');
      expect(titles).not.toContain('Gemini Floating HUD');
      expect(titles).toContain('Google Chrome');
      expect(titles).toContain('Visual Studio Code');
    });

    it('handles unsupported layout gracefully without throwing', async () => {
      const res = await appManager.tileWindows('unknown-3d-spiral' as any);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Unsupported layout');
    });

    it('retrieves valid work area and window bounds using real Win32Input in non-mock mode', async () => {
      if (process.platform !== 'win32') return;

      const realManager = new AppManagerService({ mockMode: false });
      const wa = await realManager.getWorkArea();
      expect(wa.width).toBeGreaterThan(0);
      expect(wa.height).toBeGreaterThan(0);

      const bounds = await realManager.getWindowBounds('NonExistentAppWindow');
      expect(bounds).toBeDefined();
      expect(typeof bounds.x).toBe('number');
    });
  });
});
