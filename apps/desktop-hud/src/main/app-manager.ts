import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CommandResult,
  LaunchResult,
  TileWindowsOptions,
  TileWindowsResult,
  TiledWindowInfo,
  WindowItem,
  WindowTilingLayout,
} from './types.js';
import type { JarvisMemoryStore } from './jarvis-memory.js';

export interface AppManagerOptions {
  mockMode?: boolean;
  scriptsDir?: string;
  memoryStore?: JarvisMemoryStore;
}

const APP_ALIASES: Record<string, { cmd: string; defaultArgs?: string[] }> = {
  notepad: { cmd: 'notepad.exe' },
  calculator: { cmd: 'calc.exe' },
  calc: { cmd: 'calc.exe' },
  explorer: { cmd: 'explorer.exe' },
  files: { cmd: 'explorer.exe' },
  terminal: { cmd: 'powershell.exe' },
  powershell: { cmd: 'powershell.exe' },
  cmd: { cmd: 'cmd.exe' },
  word: { cmd: 'winword.exe' },
  excel: { cmd: 'excel.exe' },
  chrome: { cmd: 'chrome.exe' },
  code: { cmd: 'code.cmd' },
  vscode: { cmd: 'code.cmd' },
  pdf: { cmd: 'msedge.exe' },
};

const BLOCKED_COMMAND_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\brmdir\s+(\/[sq]\s+)+[a-z]:\\?$/i,
  /\bdel\s+(\/[sqf]\s+)+[a-z]:\\/i,
  /\b(stop-computer|restart-computer)\b/i,
  /\bshutdown\s+[/-][st]/i,
  /\bremove-item\s+.*-recurse\s+c:\\?$/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, // fork bomb
];

function findExecutableForApp(appName: string): { exe: string; defaultArgs: string[] } | null {
  const raw = appName.trim().toLowerCase();

  if (raw === 'chrome' || raw === 'google chrome' || raw.includes('chrome')) {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env.PROGRAMFILES
        ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));

    if (candidates.length > 0 && candidates[0]) {
      return {
        exe: candidates[0],
        defaultArgs: ['--remote-debugging-port=9222', 'https://www.google.com'],
      };
    }
    return { exe: 'chrome.exe', defaultArgs: ['https://www.google.com'] };
  }

  if (raw === 'code' || raw === 'vscode' || raw.includes('visual studio code')) {
    const candidates = [
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
        : undefined,
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));

    if (candidates.length > 0 && candidates[0]) {
      return { exe: candidates[0], defaultArgs: [] };
    }
    return { exe: 'code.cmd', defaultArgs: [] };
  }

  if (raw === 'edge' || raw === 'msedge' || raw === 'pdf') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));

    if (candidates.length > 0 && candidates[0]) {
      return { exe: candidates[0], defaultArgs: [] };
    }
    return { exe: 'msedge.exe', defaultArgs: [] };
  }

  if (raw === 'word' || raw === 'winword') {
    const candidates = [
      'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
      'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));
    if (candidates.length > 0 && candidates[0]) {
      return { exe: candidates[0], defaultArgs: [] };
    }
    return { exe: 'winword.exe', defaultArgs: [] };
  }

  if (raw === 'excel') {
    const candidates = [
      'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
      'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));
    if (candidates.length > 0 && candidates[0]) {
      return { exe: candidates[0], defaultArgs: [] };
    }
    return { exe: 'excel.exe', defaultArgs: [] };
  }

  if (raw === 'notepad') {
    return { exe: 'notepad.exe', defaultArgs: [] };
  }

  if (raw === 'calc' || raw === 'calculator') {
    return { exe: 'calc.exe', defaultArgs: [] };
  }

  if (raw === 'explorer' || raw === 'files') {
    return { exe: 'explorer.exe', defaultArgs: [] };
  }

  if (raw === 'terminal' || raw === 'powershell') {
    return { exe: 'powershell.exe', defaultArgs: [] };
  }

  if (raw === 'cmd') {
    return { exe: 'cmd.exe', defaultArgs: [] };
  }

  return null;
}

export class AppManagerService {
  private mockMode: boolean;
  private scriptsDir: string;
  private memoryStore?: JarvisMemoryStore;
  private activeProcesses: Set<ChildProcess> = new Set();
  private simulatedWindows: WindowItem[] = [
    {
      hwnd: 1001,
      title: 'Google Chrome',
      processName: 'chrome',
      pid: 4500,
      isVisible: true,
      isIconic: false,
      bounds: { x: 50, y: 50, width: 1200, height: 800 },
    },
    {
      hwnd: 1002,
      title: 'Visual Studio Code',
      processName: 'Code',
      pid: 6100,
      isVisible: true,
      isIconic: false,
      bounds: { x: 100, y: 100, width: 1200, height: 800 },
    },
    {
      hwnd: 1003,
      title: 'Windows PowerShell',
      processName: 'powershell',
      pid: 8200,
      isVisible: true,
      isIconic: false,
      bounds: { x: 150, y: 150, width: 800, height: 600 },
    },
    {
      hwnd: 1004,
      title: 'Calculator',
      processName: 'calc',
      pid: 9300,
      isVisible: true,
      isIconic: false,
      bounds: { x: 200, y: 200, width: 400, height: 500 },
    },
  ];

  constructor(options: AppManagerOptions = {}) {
    this.mockMode = options.mockMode ?? process.platform !== 'win32';
    this.scriptsDir = options.scriptsDir || 'E:\\Gemetron\\scripts';
    this.memoryStore = options.memoryStore;
  }

  public setMockMode(enabled: boolean): void {
    this.mockMode = enabled;
  }

  public get isMockMode(): boolean {
    return this.mockMode;
  }

  public setMemoryStore(store: JarvisMemoryStore): void {
    this.memoryStore = store;
  }

  public getMemoryStore(): JarvisMemoryStore | undefined {
    return this.memoryStore;
  }

  /**
   * List all running top-level desktop windows
   */
  public async listRunningWindows(): Promise<WindowItem[]> {
    if (this.mockMode) {
      return [...this.simulatedWindows];
    }

    try {
      let output = '';
      try {
        output = await this.runCli('list-windows');
      } catch {
        output = await this.evalWin32(`[Gemetron.Win32Input]::ListWindows()`);
      }

      if (output && output.startsWith('[')) {
        const parsed = JSON.parse(output) as WindowItem[];
        return parsed;
      }
    } catch (err) {
      console.warn('[AppManager] Failed to list windows via Win32:', err);
    }

    return [...this.simulatedWindows];
  }

  /**
   * Launch a desktop application by name or path
   */
  public async launchApplication(appName: string, args: string[] = []): Promise<LaunchResult> {
    const raw = appName.trim().toLowerCase();
    const memAlias = this.memoryStore?.getAlias(raw);
    let executable = appName;
    let finalArgs = args;

    if (memAlias) {
      executable = memAlias.targetApp;
      finalArgs = memAlias.arguments ? [...memAlias.arguments, ...args] : args;
      this.memoryStore?.recordAliasUsage(raw);
    } else {
      const resolved = findExecutableForApp(raw);
      if (resolved) {
        executable = resolved.exe;
        finalArgs = args.length > 0 ? args : resolved.defaultArgs;
      } else {
        const alias = APP_ALIASES[raw];
        executable = alias ? alias.cmd : appName;
        finalArgs = alias?.defaultArgs ? [...alias.defaultArgs, ...args] : args;
      }
    }

    if (this.mockMode) {
      const mockPid = Math.floor(1000 + Math.random() * 9000);
      this.simulatedWindows.push({
        hwnd: 2000 + mockPid,
        title: `${appName} (Launched)`,
        processName: executable.replace(/\.exe$/i, ''),
        pid: mockPid,
        isVisible: true,
        isIconic: false,
      });
      return { ok: true, appName, pid: mockPid };
    }

    return new Promise((resolve) => {
      let settled = false;
      try {
        const useShell = !executable.includes('\\');
        const child = spawn(executable, finalArgs, {
          detached: true,
          stdio: 'ignore',
          shell: useShell,
        });

        child.on('error', (err) => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              appName,
              error: err.message,
            });
          }
        });

        // Allow app window to spawn and verify presence
        setTimeout(async () => {
          if (!settled) {
            settled = true;
            child.unref();

            let foundTitle: string | undefined;
            try {
              const windows = await this.listRunningWindows();
              const found = this.resolveAppWindow(appName, windows);
              if (found) {
                foundTitle = found.title;
                await this.focusWindow(found.hwnd);
              }
            } catch {}

            resolve({
              ok: true,
              appName,
              pid: child.pid,
              windowTitle: foundTitle,
            });
          }
        }, 500);
      } catch (err) {
        if (!settled) {
          settled = true;
          resolve({
            ok: false,
            appName,
            error: (err as Error).message,
          });
        }
      }
    });
  }

  /**
   * Focus and bring an application window to the foreground
   */
  public async focusWindow(query: string | number): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const win = this.simulatedWindows.find(
        (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
      );
      if (win) {
        win.isVisible = true;
        win.isIconic = false;
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('focus', [q]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::FocusWindow('${escaped}')`);
    }
  }

  /**
   * Minimize an application window
   */
  public async minimizeWindow(query: string | number): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const isForegroundQuery = !q || q === 'active' || q === 'current' || q === 'foreground';
      const win = isForegroundQuery
        ? this.simulatedWindows[0]
        : this.simulatedWindows.find(
            (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
          );
      if (win) {
        win.isIconic = true;
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('minimize', [q]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::MinimizeWindow('${escaped}')`);
    }
  }

  /**
   * Maximize an application window
   */
  public async maximizeWindow(query: string | number): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const isForegroundQuery = !q || q === 'active' || q === 'current' || q === 'foreground';
      const win = isForegroundQuery
        ? this.simulatedWindows[0]
        : this.simulatedWindows.find(
            (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
          );
      if (win) {
        win.isIconic = false;
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('maximize', [q]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::MaximizeWindow('${escaped}')`);
    }
  }

  /**
   * Restore an application window from minimized or maximized state
   */
  public async restoreWindow(query: string | number): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const isForegroundQuery = !q || q === 'active' || q === 'current' || q === 'foreground';
      const win = isForegroundQuery
        ? this.simulatedWindows[0]
        : this.simulatedWindows.find(
            (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
          );
      if (win) {
        win.isIconic = false;
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('restore', [q]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::RestoreWindow('${escaped}')`);
    }
  }

  /**
   * Close an application window
   */
  public async closeWindow(query: string | number): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const isForegroundQuery = !q || q === 'active' || q === 'current' || q === 'foreground';
      const idx = isForegroundQuery
        ? 0
        : this.simulatedWindows.findIndex(
            (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
          );
      if (idx >= 0 && this.simulatedWindows[idx]) {
        this.simulatedWindows.splice(idx, 1);
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('close', [q]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(`[Gemetron.Win32Input]::CloseWindow('${escaped}')`);
    }
  }

  /**
   * Get display work area (usable desktop screen excluding taskbar) for primary (0) or secondary (1+) display
   */
  public async getWorkArea(
    monitorIndex = 0,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    if (this.mockMode) {
      if (monitorIndex > 0) {
        return { x: 1920 * monitorIndex, y: 0, width: 1920, height: 1040 };
      }
      return { x: 0, y: 0, width: 1920, height: 1040 };
    }

    try {
      const electron = await import('electron');
      const sc = electron.screen;
      if (sc && typeof sc.getAllDisplays === 'function') {
        const displays = sc.getAllDisplays();
        if (displays && displays[monitorIndex]) {
          const d = displays[monitorIndex]!;
          return {
            x: d.workArea.x,
            y: d.workArea.y,
            width: d.workArea.width,
            height: d.workArea.height,
          };
        }
      }
    } catch {
      // Fallback to Win32 CLI or default
    }

    try {
      const res = await this.runCli('work-area', monitorIndex > 0 ? [String(monitorIndex)] : []);
      if (res && res.trim().startsWith('{')) {
        return JSON.parse(res.trim());
      }
    } catch {}

    if (monitorIndex > 0) {
      return { x: 1920 * monitorIndex, y: 0, width: 1920, height: 1040 };
    }
    return { x: 0, y: 0, width: 1920, height: 1040 };
  }

  /**
   * Move and resize a window to exact screen coordinates
   */
  public async moveWindow(
    query: string | number,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<boolean> {
    const q = String(query).trim();
    if (this.mockMode) {
      const win = this.simulatedWindows.find(
        (w) => String(w.hwnd) === q || w.title.toLowerCase().includes(q.toLowerCase()),
      );
      if (win) {
        win.isVisible = true;
        win.isIconic = false;
        win.bounds = { ...bounds };
        return true;
      }
      return false;
    }

    try {
      const res = await this.runCli('move-window', [
        q,
        String(Math.round(bounds.x)),
        String(Math.round(bounds.y)),
        String(Math.round(bounds.width)),
        String(Math.round(bounds.height)),
      ]);
      return res.toLowerCase().includes('true');
    } catch {
      const escaped = q.replace(/'/g, "''");
      return this.invokeWin32(
        `[Gemetron.Win32Input]::MoveAndResizeWindow('${escaped}', ${Math.round(bounds.x)}, ${Math.round(bounds.y)}, ${Math.round(bounds.width)}, ${Math.round(bounds.height)})`,
      );
    }
  }

  /**
   * Helper to resolve an application window from running windows using name and aliases
   */
  public resolveAppWindow(query: string, windows: WindowItem[]): WindowItem | undefined {
    const q = query.trim().toLowerCase();
    const alias = APP_ALIASES[q];
    const aliasCmd = alias ? alias.cmd.toLowerCase().replace(/\.(exe|cmd)$/i, '') : '';

    return windows.find((w) => {
      const t = w.title.toLowerCase();
      const p = w.processName.toLowerCase();

      // Direct title or process match
      if (t.includes(q) || p.includes(q)) return true;

      // Alias command match
      if (aliasCmd && (p.includes(aliasCmd) || t.includes(aliasCmd))) return true;

      // Specific known application mappings
      if (q === 'calc' || q === 'calculator') {
        if (p.includes('calc') || t.includes('calculator')) return true;
      }
      if (q === 'pdf') {
        if (
          p.includes('msedge') ||
          p.includes('acrobat') ||
          p.includes('foxit') ||
          t.includes('edge') ||
          t.includes('pdf')
        ) {
          return true;
        }
      }
      if (q === 'terminal' || q === 'powershell') {
        if (p.includes('powershell') || p.includes('pwsh') || t.includes('powershell')) return true;
      }
      if (q === 'cmd') {
        if (p.includes('cmd') || t.includes('command prompt')) return true;
      }
      if (q === 'word') {
        if (p.includes('winword') || t.includes('word')) return true;
      }
      if (q === 'excel') {
        if (p.includes('excel') || t.includes('excel')) return true;
      }
      if (q === 'code' || q === 'vscode') {
        if (p.includes('code') || t.includes('visual studio code')) return true;
      }
      return false;
    });
  }

  /**
   * Automatically tiles and arranges desktop windows into productivity layouts
   */
  public async tileWindows(
    layout: WindowTilingLayout,
    options: TileWindowsOptions = {},
  ): Promise<TileWindowsResult> {
    const workArea = options.workArea ?? (await this.getWorkArea(options.monitorIndex));
    const tiledWindows: TiledWindowInfo[] = [];

    switch (layout) {
      case 'side-by-side': {
        // Snap Chrome to Left 50%, target app to Right 50%
        const leftBounds = {
          x: workArea.x,
          y: workArea.y,
          width: Math.floor(workArea.width / 2),
          height: workArea.height,
        };
        const rightBounds = {
          x: workArea.x + Math.floor(workArea.width / 2),
          y: workArea.y,
          width: Math.ceil(workArea.width / 2),
          height: workArea.height,
        };

        // 1. Position Chrome on Left
        let allWindows = await this.listRunningWindows();
        let chromeWin = this.resolveAppWindow('chrome', allWindows);

        if (!chromeWin) {
          await this.launchApplication('chrome');
          if (this.mockMode) {
            chromeWin = this.resolveAppWindow('chrome', this.simulatedWindows);
          } else {
            await new Promise((r) => setTimeout(r, 500));
            allWindows = await this.listRunningWindows();
            chromeWin = this.resolveAppWindow('chrome', allWindows);
          }
        }

        const chromeQuery = chromeWin?.hwnd
          ? String(chromeWin.hwnd)
          : chromeWin?.title || 'Google Chrome';
        await this.moveWindow(chromeQuery, leftBounds);
        tiledWindows.push({
          title: chromeWin?.title || 'Google Chrome',
          hwnd: chromeWin?.hwnd,
          bounds: leftBounds,
        });

        // 2. Position Target App on Right
        const targetApp = options.targetApp || 'notepad';
        let targetWin = this.resolveAppWindow(targetApp, allWindows);

        if (!targetWin) {
          await this.launchApplication(targetApp);
          if (this.mockMode) {
            targetWin = this.resolveAppWindow(targetApp, this.simulatedWindows);
          } else {
            await new Promise((r) => setTimeout(r, 500));
            const fresh = await this.listRunningWindows();
            targetWin = this.resolveAppWindow(targetApp, fresh);
          }
        }

        const targetQuery = targetWin?.hwnd
          ? String(targetWin.hwnd)
          : targetWin?.title || targetApp;
        await this.moveWindow(targetQuery, rightBounds);

        // Bring both windows cleanly into focus (Chrome left, then target right)
        await this.focusWindow(chromeQuery);
        await this.focusWindow(targetQuery);

        tiledWindows.push({
          title: targetWin?.title || targetApp,
          hwnd: targetWin?.hwnd,
          bounds: rightBounds,
        });

        return {
          success: true,
          layout: 'side-by-side',
          tiledWindows,
          message: `Tiled "${chromeWin?.title || 'Google Chrome'}" on Left 50% and "${targetWin?.title || targetApp}" on Right 50%`,
        };
      }

      case 'maximize-target': {
        const targetApp = options.targetApp || 'Google Chrome';
        let allWindows = await this.listRunningWindows();
        let targetWin = this.resolveAppWindow(targetApp, allWindows);

        if (!targetWin) {
          await this.launchApplication(targetApp);
          if (this.mockMode) {
            targetWin = this.resolveAppWindow(targetApp, this.simulatedWindows);
          } else {
            await new Promise((r) => setTimeout(r, 500));
            allWindows = await this.listRunningWindows();
            targetWin = this.resolveAppWindow(targetApp, allWindows);
          }
        }

        const targetQuery = targetWin?.hwnd
          ? String(targetWin.hwnd)
          : targetWin?.title || targetApp;
        if (options.monitorIndex !== undefined && options.monitorIndex > 0) {
          await this.moveWindow(targetQuery, workArea);
        }
        await this.focusWindow(targetQuery);
        await this.maximizeWindow(targetQuery);
        if (typeof targetApp === 'string' && targetApp.toLowerCase().includes('chrome')) {
          await this.maximizeWindow('chrome');
        }

        tiledWindows.push({
          title: targetWin?.title || targetApp,
          hwnd: targetWin?.hwnd,
          bounds: { ...workArea },
        });

        return {
          success: true,
          layout: 'maximize-target',
          tiledWindows,
          message: `Maximized target app "${targetWin?.title || targetApp}" while Desktop HUD remains floating`,
        };
      }

      case 'grid-2x2': {
        const halfW = Math.floor(workArea.width / 2);
        const halfH = Math.floor(workArea.height / 2);
        const slots = [
          { x: workArea.x, y: workArea.y, width: halfW, height: halfH },
          { x: workArea.x + halfW, y: workArea.y, width: workArea.width - halfW, height: halfH },
          { x: workArea.x, y: workArea.y + halfH, width: halfW, height: workArea.height - halfH },
          {
            x: workArea.x + halfW,
            y: workArea.y + halfH,
            width: workArea.width - halfW,
            height: workArea.height - halfH,
          },
        ];

        let targetCandidates: Array<{ query: string | number; title: string; hwnd?: number }>;
        if (options.windowTitles && options.windowTitles.length > 0) {
          targetCandidates = options.windowTitles.slice(0, 4).map((t) => ({ query: t, title: t }));
        } else {
          const allWindows = await this.listRunningWindows();
          const filtered = allWindows.filter(
            (w) =>
              w.isVisible &&
              w.title.trim().length > 0 &&
              w.title !== 'Program Manager' &&
              w.title !== 'Windows Input Experience' &&
              !w.processName.toLowerCase().includes('textinput') &&
              !w.processName.toLowerCase().includes('dwm') &&
              !w.processName.toLowerCase().includes('searchhost') &&
              !w.processName.toLowerCase().includes('shellexperience') &&
              !w.title.toLowerCase().includes('hud') &&
              !w.title.toLowerCase().includes('gemini floating') &&
              !w.title.toLowerCase().includes('jarvis'),
          );
          targetCandidates = filtered
            .slice(0, 4)
            .map((w) => ({ query: w.hwnd ?? w.title, title: w.title, hwnd: w.hwnd }));
        }

        for (let i = 0; i < targetCandidates.length && i < slots.length; i++) {
          const candidate = targetCandidates[i]!;
          const slot = slots[i]!;
          await this.moveWindow(candidate.query, slot);
          tiledWindows.push({
            title: candidate.title,
            hwnd: candidate.hwnd,
            bounds: slot,
          });
        }

        return {
          success: true,
          layout: 'grid-2x2',
          tiledWindows,
          message: `Arranged ${tiledWindows.length} windows in a 2x2 multi-tasking grid`,
        };
      }

      default:
        return {
          success: false,
          layout,
          tiledWindows: [],
          error: `Unsupported layout: ${layout}`,
        };
    }
  }

  public async findTextOnScreen(
    query: string,
    windowScope?: string,
  ) {
    return this.findText(query, windowScope);
  }

  /**
   * Search desktop window titles and child controls for matching text
   */
  public async findText(
    query: string,
    windowScope?: string,
  ): Promise<
    Array<{
      text: string;
      x: number;
      y: number;
      bounds: { x: number; y: number; width: number; height: number };
      confidence: number;
      source: string;
      containerTitle?: string;
    }>
  > {
    const q = String(query).trim();
    if (this.mockMode) {
      const matches: Array<{
        text: string;
        x: number;
        y: number;
        bounds: { x: number; y: number; width: number; height: number };
        confidence: number;
        source: string;
        containerTitle?: string;
      }> = [];
      for (const w of this.simulatedWindows) {
        if (windowScope && !w.title.toLowerCase().includes(windowScope.toLowerCase())) {
          continue;
        }
        if (w.title.toLowerCase().includes(q.toLowerCase())) {
          matches.push({
            text: w.title,
            x: 700,
            y: 120,
            bounds: { x: 100, y: 100, width: 1200, height: 40 },
            confidence: 0.95,
            source: 'window_title',
            containerTitle: w.title,
          });
        }
      }
      return matches;
    }

    try {
      const args = windowScope ? [q, windowScope] : [q];
      const res = await this.runCli('find-text', args);
      if (res && res.trim().startsWith('[')) {
        return JSON.parse(res.trim());
      }
    } catch {
      try {
        const escaped = q.replace(/'/g, "''");
        const scopeParam = windowScope ? `'${windowScope.replace(/'/g, "''")}'` : 'null';
        const res = await this.evalWin32(
          `[Gemetron.Win32Input]::FindTextOnScreen('${escaped}', ${scopeParam})`,
        );
        if (res && res.trim().startsWith('[')) {
          return JSON.parse(res.trim());
        }
      } catch {}
    }

    return [];
  }

  /**
   * Run a system shell command with safety guardrails
   */
  public async runSystemCommand(
    command: string,
    options: { timeoutMs?: number; requiresApproval?: boolean } = {},
  ): Promise<CommandResult> {
    const started = Date.now();
    const cmd = command.trim();

    // 1. Safety check
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(cmd)) {
        return {
          ok: false,
          exitCode: -1,
          stdout: '',
          stderr: 'Command blocked by safety policy: destructive system operation prohibited.',
          command: cmd,
          durationMs: Date.now() - started,
          blocked: true,
          reason: 'Command matched catastrophic deletion/formatting rule',
        };
      }
    }

    if (this.mockMode) {
      return {
        ok: true,
        exitCode: 0,
        stdout: `[Mock Command Output for: ${cmd}]`,
        stderr: '',
        command: cmd,
        durationMs: 15,
      };
    }

    const timeout = options.timeoutMs ?? 15000;

    return new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.add(child);

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        this.activeProcesses.delete(child);
        clearTimeout(timer);
        const durationMs = Date.now() - started;
        if (timedOut) {
          resolve({
            ok: false,
            exitCode: -1,
            stdout,
            stderr: `Command timed out after ${timeout}ms`,
            command: cmd,
            durationMs,
          });
        } else {
          resolve({
            ok: code === 0,
            exitCode: code ?? 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            command: cmd,
            durationMs,
          });
        }
      });

      child.on('error', (err) => {
        this.activeProcesses.delete(child);
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: -1,
          stdout,
          stderr: err.message,
          command: cmd,
          durationMs: Date.now() - started,
        });
      });
    });
  }

  /**
   * Instantly terminate all active system commands (Emergency Killswitch support)
   */
  public abortActiveCommands(): void {
    for (const child of this.activeProcesses) {
      try {
        child.kill('SIGTERM');
        child.kill();
      } catch {}
    }
    this.activeProcesses.clear();
  }

  /**
   * Get physical desktop window bounding box coordinates
   */
  public async getWindowBounds(
    query: string | number,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const q = String(query).trim();
    if (this.mockMode) {
      return { x: 100, y: 100, width: 800, height: 600 };
    }

    try {
      const raw = await this.runCli('window-bounds', [q]);
      if (raw && raw.startsWith('{')) {
        return JSON.parse(raw);
      }
    } catch {}

    return { x: 0, y: 0, width: 0, height: 0 };
  }

  private runCli(action: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const exePath = join(this.scriptsDir, 'Win32Input.exe');
      if (!existsSync(exePath)) {
        return reject(new Error('Win32Input.exe not found'));
      }

      const child = spawn(exePath, [action, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Win32 CLI failed (${code}): ${stderr || stdout}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async invokeWin32(cmd: string): Promise<boolean> {
    try {
      await this.evalWin32(cmd);
      return true;
    } catch {
      return false;
    }
  }

  private evalWin32(snippet: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const dllPath = join(this.scriptsDir, 'Win32Input.dll');
      const csPath = join(this.scriptsDir, 'Win32Input.cs');

      const loader = existsSync(dllPath)
        ? `Add-Type -Path '${dllPath}';`
        : `Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -Path '${csPath}';`;

      const psScript = `${loader} ${snippet}`;

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Win32 execution failed (${code}): ${stderr || stdout}`));
        }
      });

      child.on('error', reject);
    });
  }
}
