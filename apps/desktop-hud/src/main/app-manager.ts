import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import type {
  CommandResult,
  DocumentMatch,
  LaunchResult,
  TileWindowsOptions,
  TileWindowsResult,
  TiledWindowInfo,
  WindowItem,
  WindowTilingLayout,
} from './types.js';
import type { JarvisMemoryStore } from './jarvis-memory.js';
import type { BrowserGateway } from './browser-gateway.js';
import { SCRIPTS_DIR } from './runtime-paths.js';
import { assessCommand, redactCommand } from './command-policy.js';
import type { ApplicationAdapterRegistry } from './application-adapters.js';

export interface AppManagerOptions {
  mockMode?: boolean;
  scriptsDir?: string;
  memoryStore?: JarvisMemoryStore;
  browserGateway?: BrowserGateway;
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

/** Names that should be handed to the browser gateway rather than spawned. */
function isBrowserName(raw: string): boolean {
  return (
    raw.includes('chrome') ||
    raw.includes('edge') ||
    raw.includes('msedge') ||
    raw === 'browser' ||
    raw === 'google' ||
    raw === 'google chrome'
  );
}

/**
 * Score how well a document answers a request.
 *
 * "report" should find "Q3 report.pdf"; "pdf" should find every PDF. An empty
 * query means "the most recent documents" and is handled by the caller.
 */
function scoreDocument(doc: DocumentMatch, wanted: string): number {
  if (!wanted) return 1;
  const name = doc.name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, '');
  const extension = doc.extension;

  if (name === wanted || stem === wanted) return 100;
  if (name.startsWith(wanted)) return 80;
  if (stem.startsWith(wanted)) return 70;
  if (name.includes(wanted)) return 50;
  if (stem.includes(wanted)) return 40;
  if (extension === `.${wanted.replace(/^\./, '')}`) return 30;
  return 0;
}

export function findExecutableForApp(appName: string): { exe: string; defaultArgs: string[] } | null {
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
        defaultArgs: [],
      };
    }
    return { exe: 'chrome.exe', defaultArgs: [] };
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
  private browserGateway?: BrowserGateway;
  private adapterRegistry?: ApplicationAdapterRegistry;
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
    this.scriptsDir = options.scriptsDir || SCRIPTS_DIR;
    this.memoryStore = options.memoryStore;
    this.browserGateway = options.browserGateway;
  }

  public setBrowserGateway(gateway: BrowserGateway): void {
    this.browserGateway = gateway;
  }

  public setAdapterRegistry(registry: ApplicationAdapterRegistry): void {
    this.adapterRegistry = registry;
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

    return []; // Never fake real desktop state. An empty list is honest; fake windows make the agent lie.
  }

  /**
   * Launch a desktop application by name or path.
   *
   * The resolution order is deliberate and single-sourced:
   *   1. a memory alias that carries intent (arguments or an absolute path)
   *   2. the browser gateway for browser names
   *   3. the known-executable table, which yields a real absolute path
   *   4. the static alias table
   *   5. the raw name
   *
   * A default memory alias such as "chrome" holds a bare "chrome.exe" that is
   * usually not on PATH, so it must never shadow steps 2 and 3.
   */
  public async launchApplication(appName: string, args: string[] = []): Promise<LaunchResult> {
    const raw = appName.trim().toLowerCase();
    const adapter = this.adapterRegistry?.resolve(raw);
    if (adapter) {
      const available = await adapter.isAvailable();
      if (!available) {
        return { ok: false, appName, error: `${appName} is not installed.` };
      }
      return adapter.launch(args);
    }
    const memAlias = this.memoryStore?.getAlias(raw);
    const aliasCarriesIntent =
      Boolean(memAlias) &&
      (Boolean(memAlias?.arguments?.length) || isAbsolute(memAlias?.targetApp ?? ''));

    if (aliasCarriesIntent) {
      this.memoryStore?.recordAliasUsage(raw);
    }

    // A browser is handled by the gateway: it attaches to the running
    // instance or launches it with a resolved path, and it never spawns a
    // second Chrome.
    if (!aliasCarriesIntent && this.browserGateway && isBrowserName(raw)) {
      const url = args.find((a) => /^https?:\/\//i.test(a));
      const res = url
        ? await this.browserGateway.openTab(url)
        : await this.browserGateway.focusOrLaunch();
      return {
        ok: res.success,
        appName,
        windowTitle: res.windowTitle ?? (res.success ? 'Google Chrome' : undefined),
        verified: res.success,
        error: res.error,
      };
    }

    const target = this.resolveLaunchTarget(raw, args, memAlias);
    return this.launchDirect(target.executable, target.args, appName, raw);
  }

  /**
   * Launch an already-resolved executable and verify that a window appears.
   *
   * Split out from {@link launchApplication} so the application adapters can
   * spawn an executable without re-running the resolver (which would loop).
   */
  public async launchDirect(
    executable: string,
    finalArgs: string[],
    appName: string,
    raw: string,
  ): Promise<LaunchResult> {
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
      return { ok: true, appName, pid: mockPid, verified: true };
    }

    // Real launch: no shell for .exe (shell swallows "not found" errors).
    const useShell = /\.(cmd|bat)$/i.test(executable);
    let spawnError: string | null = null;
    let spawnErrorCode: string | null = null;
    let exitCode: number | null = null;
    let child: ChildProcess | null = null;
    let started: boolean;

    try {
      child = spawn(executable, finalArgs, {
        detached: true,
        stdio: 'ignore',
        shell: useShell,
        windowsHide: false,
      });
      started = await new Promise<boolean>((resolve) => {
        const grace = setTimeout(() => resolve(true), 2000);
        child?.on('error', (err: NodeJS.ErrnoException) => {
          clearTimeout(grace);
          spawnError = err.message;
          spawnErrorCode = err.code ?? null;
          resolve(false);
        });
        child?.on('exit', (code) => {
          exitCode = code;
        });
        child?.unref();
      });
    } catch (err) {
      spawnError = (err as Error).message;
      started = false;
    }

    // Fallback: find ANY installed app via the Start Menu index (UWP + Win32).
    if (!started && spawnErrorCode === 'ENOENT' && !isAbsolute(executable)) {
      const startApp = await this.resolveStartApp(raw);
      if (startApp) {
        spawnError = null;
        spawnErrorCode = null;
        exitCode = null;
        try {
          const shellChild = spawn('explorer.exe', [`shell:AppsFolder\\${startApp.appId}`], {
            detached: true,
            stdio: 'ignore',
          });
          shellChild.unref();
        } catch (err) {
          spawnError = (err as Error).message;
        }
      }
    }
    if (spawnError) {
      const detail =
        spawnErrorCode === 'ENOENT'
          ? `"${executable}" was not found: it is not on PATH and not installed where it was expected.`
          : spawnError;
      return { ok: false, appName, error: `Could not start "${appName}": ${detail}` };
    }

    // VERIFY a real window appears (up to 10 s), then focus it. No fake success.
    const exeBase = executable.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (exitCode !== null && exitCode !== 0) {
        return {
          ok: false,
          appName,
          error: `"${executable}" exited with code ${exitCode}; no window verified.`,
        };
      }
      const windows = await this.listRunningWindows().catch(() => [] as WindowItem[]);
      const found = this.resolveAppWindow(raw, windows) ?? this.resolveAppWindow(exeBase, windows);
      if (found) {
        const focused = await this.focusWindow(found.hwnd).catch(() => false);
        return {
          ok: true,
          appName,
          pid: child?.pid,
          windowTitle: found.title,
          verified: focused,
        };
      }
    }
    return {
      ok: false,
      appName,
      error: `Started "${executable}" but no matching window appeared within 10 seconds.`,
    };
  }

  /**
   * Resolve a launch target from the known sources, in priority order.
   *
   * Kept separate from {@link launchApplication} so the same rules apply to
   * every entry point (voice tool, skill, workflow step).
   */
  private resolveLaunchTarget(
    raw: string,
    args: string[],
    memAlias: { targetApp: string; arguments?: string[] } | undefined,
  ): { executable: string; args: string[] } {
    if (memAlias && (memAlias.arguments?.length || isAbsolute(memAlias.targetApp))) {
      return {
        executable: memAlias.targetApp,
        args: memAlias.arguments ? [...memAlias.arguments, ...args] : args,
      };
    }
    const resolved = findExecutableForApp(raw);
    if (resolved) {
      return {
        executable: resolved.exe,
        args: args.length > 0 ? args : resolved.defaultArgs,
      };
    }
    const alias = APP_ALIASES[raw];
    if (alias) {
      return {
        executable: alias.cmd,
        args: alias.defaultArgs ? [...alias.defaultArgs, ...args] : args,
      };
    }
    if (memAlias) {
      return {
        executable: memAlias.targetApp,
        args: memAlias.arguments ? [...memAlias.arguments, ...args] : args,
      };
    }
    return { executable: raw, args };
  }

  private startAppsCache: { at: number; apps: Array<{ name: string; appId: string }> } | null =
    null;

  private async resolveStartApp(name: string): Promise<{ name: string; appId: string } | null> {
    try {
      if (!this.startAppsCache || Date.now() - this.startAppsCache.at > 60000) {
        const out = await new Promise<string>((resolve, reject) => {
          const c = spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Get-StartApps | ConvertTo-Json -Compress',
            ],
            { stdio: ['ignore', 'pipe', 'ignore'] },
          );
          let s = '';
          const timer = setTimeout(() => {
            c.kill();
            reject(new Error('Get-StartApps timeout'));
          }, 8000);
          c.stdout.on('data', (d) => {
            s += d.toString();
          });
          c.on('close', () => {
            clearTimeout(timer);
            resolve(s);
          });
          c.on('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
        });
        const parsed = JSON.parse(out);
        const apps = (Array.isArray(parsed) ? parsed : [parsed]).map((a: any) => ({
          name: String(a.Name ?? ''),
          appId: String(a.AppID ?? ''),
        }));
        this.startAppsCache = { at: Date.now(), apps };
      }
      const q = name.toLowerCase();
      const apps = this.startAppsCache.apps;
      return (
        apps.find((a) => a.name.toLowerCase() === q) ??
        apps.find((a) => a.name.toLowerCase().startsWith(q)) ??
        apps.find((a) => a.name.toLowerCase().includes(q)) ??
        null
      );
    } catch {
      return null;
    }
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
   * Resolve a well-known folder (desktop, documents, downloads, pictures...).
   *
   * The shell owns the mapping, so OneDrive redirection and localised folder
   * names are handled correctly. A hardcoded "%USERPROFILE%\Desktop" is not.
   */
  public async knownFolder(name = 'desktop'): Promise<string> {
    if (this.mockMode) return '';
    const key = name.trim().toLowerCase() || 'desktop';
    try {
      const res = await this.runCli('known-folder', [key]);
      return res.trim();
    } catch {
      try {
        const output = await this.evalWin32(
          `[Gemetron.Win32Input]::KnownFolder('${key.replace(/'/g, "''")}')`,
        );
        return output.trim();
      } catch {
        return '';
      }
    }
  }

  /**
   * Find documents by name or extension.
   *
   * `folder` may be a known-folder name ("desktop") or an absolute path. The
   * search stays shallow on purpose: a request like "the PDF on my desktop"
   * should not walk the whole profile.
   */
  public async findDocuments(query: string, folder = 'desktop'): Promise<DocumentMatch[]> {
    const wanted = query.trim().toLowerCase();
    const target = folder.trim();
    const root = isAbsolute(target) ? target : await this.knownFolder(target || 'desktop');
    if (!root || !existsSync(root)) return [];

    const collected: DocumentMatch[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 2) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const stat = statSync(full);
          collected.push({
            path: full,
            name: entry.name,
            extension: extname(entry.name).toLowerCase(),
            sizeBytes: stat.size,
            modifiedAt: stat.mtimeMs,
            folder: dir,
            score: 0,
          });
        } catch {
          /* the file vanished between listing and stat */
        }
      }
    };
    walk(root, 0);

    const scored = collected
      .map((doc) => ({ doc, score: scoreDocument(doc, wanted) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.doc.modifiedAt - a.doc.modifiedAt)
      .slice(0, 10)
      .map((entry) => entry.doc);
    return scored;
  }

  /**
   * Open a document with its registered default application.
   *
   * The shell accepts the request; the caller still needs proof that a viewer
   * window appeared, so the new window is located and focused.
   */
  public async openDocument(filePath: string): Promise<{
    ok: boolean;
    windowTitle?: string;
    error?: string;
  }> {
    const target = filePath.trim();
    if (!target) return { ok: false, error: 'No document path was given.' };
    if (!existsSync(target)) {
      return { ok: false, error: `Document not found: ${target}` };
    }
    if (this.mockMode) {
      return { ok: true, windowTitle: `${basename(target)} (Opened)` };
    }

    const before = await this.listRunningWindows().catch(() => [] as WindowItem[]);
    let accepted: boolean;
    try {
      const encoded = Buffer.from(target, 'utf8').toString('base64');
      const res = await this.runCli('open-document', [encoded]);
      accepted = res.toLowerCase().includes('true');
    } catch {
      accepted = await this.invokeWin32(
        `[Gemetron.Win32Input]::OpenDocument('${target.replace(/'/g, "''")}')`,
      );
    }
    if (!accepted) {
      return { ok: false, error: `The shell refused to open "${target}".` };
    }

    const stem = basename(target, extname(target)).toLowerCase();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const after = await this.listRunningWindows().catch(() => [] as WindowItem[]);
      const fresh = after.filter((w) => !before.some((b) => b.hwnd === w.hwnd));
      const viewer =
        fresh.find((w) => w.title.toLowerCase().includes(stem)) ??
        fresh.find((w) => w.isVisible) ??
        fresh[0];
      if (viewer) {
        // The shell can ask the user which application should handle the
        // file instead of opening it. That is not a successful open.
        if (/pick an app|how do you want to open|choose an app/i.test(viewer.title)) {
          return {
            ok: false,
            error: `The system asked which application should open "${target}". No default handler is registered for this file type.`,
          };
        }
        await this.focusWindow(viewer.hwnd).catch(() => false);
        return { ok: true, windowTitle: viewer.title };
      }
    }
    return {
      ok: false,
      error: `"${target}" was handed to the shell but no viewer window appeared within 8 seconds.`,
    };
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
              !w.title.toLowerCase().includes('gemetron') &&
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

  public async findTextOnScreen(query: string, windowScope?: string) {
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
   * Run a system shell command with a capability/risk policy.
   *
   * Blocked commands never execute. Dangerous commands require an explicit
   * `approved: true` from a human decision (workflow approval step), so the
   * agent cannot silently escalate from a read-only query to a destructive
   * operation even when automatic approval is enabled for ordinary steps.
   */
  public async runSystemCommand(
    command: string,
    options: {
      timeoutMs?: number;
      requiresApproval?: boolean;
      /** Set only after a human approved this specific command. */
      approved?: boolean;
      /** Trusted internal callers that must bypass the approval gate. */
      allowDangerous?: boolean;
      audit?: (event: string, details?: Record<string, unknown>) => void;
    } = {},
  ): Promise<CommandResult> {
    const started = Date.now();
    const cmd = command.trim();
    const assessment = assessCommand(cmd);

    // 1. Hard policy: blocked commands never run.
    if (assessment.blocked) {
      options.audit?.('command:blocked', {
        command: redactCommand(cmd),
        risk: assessment.risk,
        rules: assessment.matchedRules,
      });
      return {
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: `Command blocked by safety policy: ${assessment.reasons.join(' ')}`,
        command: cmd,
        durationMs: Date.now() - started,
        blocked: true,
        reason: assessment.reasons.join(' '),
      };
    }

    // 2. Dangerous commands need a human decision.
    const needsApproval = assessment.risk === 'dangerous' || options.requiresApproval === true;
    if (needsApproval && options.approved !== true && options.allowDangerous !== true) {
      options.audit?.('command:approval-required', {
        command: redactCommand(cmd),
        risk: assessment.risk,
        rules: assessment.matchedRules,
      });
      return {
        ok: false,
        exitCode: -1,
        stdout: '',
        stderr: `Command requires explicit approval (risk: ${assessment.risk}). ${assessment.reasons.join(' ')}`,
        command: cmd,
        durationMs: Date.now() - started,
        blocked: true,
        reason: `approval-required:${assessment.risk}`,
      };
    }

    if (assessment.risk !== 'safe') {
      options.audit?.('command:executed', {
        command: redactCommand(cmd),
        risk: assessment.risk,
        rules: assessment.matchedRules,
        approved: options.approved === true || options.allowDangerous === true,
      });
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

  /**
   * Run one native helper command.
   *
   * The call is always bounded: the helper talks to the window manager and
   * to the shell, and a modal system dialog can keep it alive indefinitely.
   * An unbounded call would hang the whole agent instead of failing one step.
   */
  private runCli(action: string, args: string[] = [], timeoutMs = 8000): Promise<string> {
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
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* the process may already be gone */
        }
        reject(new Error(`Native helper timed out during "${action}" after ${timeoutMs} ms.`));
      }, timeoutMs);
      timer.unref?.();

      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Win32 CLI failed (${code}): ${stderr || stdout}`));
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async invokeWin32(cmd: string): Promise<boolean> {
    try {
      // The helper prints the operation's real result. Treating a zero exit
      // code as success reported "focused" for windows that were never found.
      const output = await this.evalWin32(cmd);
      return /(^|\W)true(\W|$)/i.test(output);
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
        : `Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Runtime.Serialization,WindowsBase,UIAutomationClient,UIAutomationTypes -Path '${csPath}';`;

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
