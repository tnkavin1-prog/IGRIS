/**
 * BrowserGateway — the single entry point for every browser mutation.
 *
 * Exactly-once semantics for tab creation, attach-first strategy:
 *   1. CDP on 127.0.0.1:9222 when a debuggable Chrome is already running.
 *   2. Keyboard control of the user's EXISTING Chrome window (Ctrl+T /
 *      Ctrl+L) when no debug port is available — never a new instance.
 *   3. A single normal-profile Chrome launch only when no Chrome is running.
 *
 * A separate debug-profile Chrome is never spawned implicitly. Duplicate
 * commands (model retries, overlapping tools) share one execution and receive
 * the original result instead of producing extra tabs.
 */

import { spawn } from 'node:child_process';
import { ChromeLauncher } from './chrome-launcher.js';
import type { CDPClient } from './cdp-client.js';
import type { AppManagerService } from './app-manager.js';
import type { NativeInputService } from './native-input.js';
import type { ChromeTabInfo, WindowItem } from './types.js';

export type BrowserStrategy = 'cdp' | 'ui-attach' | 'launch';
export type BrowserVerification = 'cdp' | 'tab-count' | 'input-acknowledged' | 'window';

export interface OpenTabResult extends Record<string, unknown> {
  success: boolean;
  url: string;
  strategy?: BrowserStrategy;
  tabId?: string;
  windowTitle?: string;
  verified?: boolean;
  verification?: BrowserVerification;
  error?: string;
  message?: string;
  deduplicated?: boolean;
  dedupNote?: string;
}

export interface BrowserGatewayDeps {
  cdpClient: CDPClient;
  appManager: AppManagerService;
  nativeInput: NativeInputService;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isDebugPortAlive?: () => Promise<boolean>;
  resolveChromeExe?: () => Promise<string | null>;
  spawnImpl?: (exe: string, args: string[]) => void;
}

export const NEW_TAB_URL = 'chrome://newtab/';

export function normalizeBrowserUrl(raw?: string): string {
  const input = (raw ?? '').trim();
  if (!input) return NEW_TAB_URL;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^(about:|chrome:\/\/newtab)/i.test(input)) return input;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(input)) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

const DEDUP_WINDOW_MS = 4000;

export class BrowserGateway {
  private cdp: CDPClient;
  private apps: AppManagerService;
  private input: NativeInputService;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private isDebugPortAlive: () => Promise<boolean>;
  private resolveChromeExe: () => Promise<string | null>;
  private spawnImpl: (exe: string, args: string[]) => void;

  private inflight = new Map<string, Promise<OpenTabResult>>();
  private recent = new Map<string, { at: number; result: OpenTabResult }>();
  private debugPidsCache: { at: number; pids: Set<number> } | null = null;

  constructor(deps: BrowserGatewayDeps) {
    this.cdp = deps.cdpClient;
    this.apps = deps.appManager;
    this.input = deps.nativeInput;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.isDebugPortAlive = deps.isDebugPortAlive ?? (() => ChromeLauncher.isPortAvailable());
    this.resolveChromeExe =
      deps.resolveChromeExe ??
      (async () =>
        ChromeLauncher.findChromeExecutable() ?? (await ChromeLauncher.findChromeViaRegistry()));
    this.spawnImpl =
      deps.spawnImpl ??
      ((exe, args) => {
        const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
        child.unref();
      });
  }

  /** Open exactly one tab. Duplicates within the window share the execution. */
  public async openTab(rawUrl?: string): Promise<OpenTabResult> {
    const url = normalizeBrowserUrl(rawUrl);
    return this.executeOnce(`open:${url}`, () => this.performOpenTab(url));
  }

  /** Navigate the current tab (CDP) or the focused existing window (Ctrl+L). */
  public async navigate(rawUrl: string, tabId?: string): Promise<OpenTabResult> {
    const url = normalizeBrowserUrl(rawUrl);
    return this.executeOnce(`navigate:${tabId ?? 'active'}:${url}`, async () => {
      if (await this.isDebugPortAlive()) {
        try {
          await this.cdp.navigate(url, tabId);
          return { success: true, url, strategy: 'cdp', verified: true };
        } catch (err) {
          return { success: false, url, strategy: 'cdp', error: (err as Error).message };
        }
      }

      const win = await this.findPreferredChromeWindow();
      if (win) {
        const focused = await this.apps.focusWindow(win.hwnd ?? win.title);
        if (!focused) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            error: 'Chrome window exists but could not be focused.',
          };
        }
        if (!(await this.input.sendHotkey('Ctrl+L'))) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            verified: false,
            windowTitle: win.title,
            error:
              'Chrome could not acknowledge the address-bar shortcut. Navigation was not retried.',
          };
        }
        if (!(await this.input.typeText(url))) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            verified: false,
            windowTitle: win.title,
            error:
              'The address bar was focused, but the URL could not be entered. Check Chrome before retrying.',
          };
        }
        if (!(await this.input.sendHotkey('Enter'))) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            verified: false,
            windowTitle: win.title,
            error:
              'The URL was entered, but Enter could not be sent. Check Chrome before retrying.',
          };
        }
        return {
          success: true,
          url,
          strategy: 'ui-attach',
          verified: false,
          verification: 'input-acknowledged',
          windowTitle: win.title,
          message:
            'Navigation keystrokes were acknowledged by the existing Chrome window; page navigation was not independently verified.',
        };
      }

      return this.launchUserChrome(url);
    });
  }

  /** Bring Chrome to the foreground without creating any tab; launch if absent. */
  public async focusOrLaunch(): Promise<OpenTabResult> {
    return this.executeOnce('focus-or-launch', async () => {
      const win = await this.findPreferredChromeWindow();
      if (win) {
        const ok = await this.apps.focusWindow(win.hwnd ?? win.title);
        return {
          success: ok,
          url: '',
          strategy: 'ui-attach',
          windowTitle: win.title,
          verified: ok,
          message: ok
            ? 'Focused the existing Chrome window.'
            : 'Chrome window could not be focused.',
          ...(ok ? {} : { error: 'Chrome window could not be focused.' }),
        };
      }
      return this.launchUserChrome(NEW_TAB_URL);
    });
  }

  private async performOpenTab(url: string): Promise<OpenTabResult> {
    if (await this.isDebugPortAlive()) {
      const before = await this.cdp.listTabs().catch(() => [] as ChromeTabInfo[]);
      const target = url === NEW_TAB_URL ? 'about:blank' : url;
      const tab = await this.cdp.createTab(target);
      if (tab?.id) {
        return { success: true, url, strategy: 'cdp', tabId: tab.id, verified: true };
      }
      // The create may have succeeded despite a timeout: re-list before
      // declaring failure so a retry can never produce a second tab.
      const after = await this.cdp.listTabs().catch(() => []);
      const created = after.find((t) => !before.some((b) => b.id === t.id));
      if (created) {
        return { success: true, url, strategy: 'cdp', tabId: created.id, verified: true };
      }
      return {
        success: false,
        url,
        strategy: 'cdp',
        error:
          'Chrome debugging port is reachable but tab creation failed. No alternative window was opened, to avoid duplicate tabs.',
      };
    }

    const win = await this.findPreferredChromeWindow();
    if (win) {
      const focused = await this.apps.focusWindow(win.hwnd ?? win.title);
      if (!focused) {
        return {
          success: false,
          url,
          strategy: 'ui-attach',
          error: 'Chrome window exists but could not be focused.',
        };
      }
      const beforeTabCount = await this.getChromeTabCount(win.title);
      if (!(await this.input.sendHotkey('Ctrl+T'))) {
        return {
          success: false,
          url,
          strategy: 'ui-attach',
          verified: false,
          windowTitle: win.title,
          error:
            'Chrome could not acknowledge Ctrl+T. No new tab was confirmed and the command was not retried.',
        };
      }

      await this.sleep(250);
      const afterTabCount = await this.getChromeTabCount(win.title);
      const tabCountVerified = beforeTabCount !== null && afterTabCount === beforeTabCount + 1;
      if (beforeTabCount !== null && afterTabCount !== null && !tabCountVerified) {
        return {
          success: false,
          url,
          strategy: 'ui-attach',
          verified: false,
          verification: 'tab-count',
          windowTitle: win.title,
          error: `Ctrl+T was sent, but Chrome's tab count changed from ${beforeTabCount} to ${afterTabCount}, not exactly ${beforeTabCount + 1}. The command was not retried.`,
        };
      }

      if (url !== NEW_TAB_URL) {
        if (!(await this.input.typeText(url))) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            verified: false,
            windowTitle: win.title,
            error:
              'Ctrl+T was sent, but the URL could not be entered. The tab may already be open; the command was not retried.',
          };
        }
        if (!(await this.input.sendHotkey('Enter'))) {
          return {
            success: false,
            url,
            strategy: 'ui-attach',
            verified: false,
            windowTitle: win.title,
            error:
              'The new-tab shortcut and URL entry were sent, but Enter failed. Check Chrome before retrying; the command was not retried.',
          };
        }
      }

      const navigationRequired = url !== NEW_TAB_URL;
      return {
        success: true,
        url,
        strategy: 'ui-attach',
        verified: tabCountVerified && !navigationRequired,
        verification: tabCountVerified ? 'tab-count' : 'input-acknowledged',
        windowTitle: win.title,
        message: tabCountVerified
          ? navigationRequired
            ? 'Exactly one new Chrome tab was observed and navigation keystrokes were acknowledged; page loading was not independently verified.'
            : 'Exactly one new tab was observed in the existing Chrome window.'
          : 'Chrome acknowledged the new-tab input, but UI Automation could not independently confirm the tab count. Do not retry automatically.',
      };
    }

    return this.launchUserChrome(url);
  }

  private async getChromeTabCount(windowTitle: string): Promise<number | null> {
    try {
      const elements = await this.input.findUIElements('', windowTitle);
      const count = elements.filter((element) => element.controlType === 'TabItem').length;
      return count > 0 ? count : null;
    } catch {
      return null;
    }
  }

  private async launchUserChrome(url: string): Promise<OpenTabResult> {
    const exe = await this.resolveChromeExe();
    if (!exe) {
      return { success: false, url, strategy: 'launch', error: 'Chrome executable not found.' };
    }

    try {
      this.spawnImpl(exe, url === NEW_TAB_URL ? [] : [url]);
    } catch (err) {
      return { success: false, url, strategy: 'launch', error: (err as Error).message };
    }

    const deadline = this.now() + 15000;
    while (this.now() < deadline) {
      await this.sleep(500);
      const win = await this.findPreferredChromeWindow();
      if (win) {
        await this.apps.focusWindow(win.hwnd ?? win.title).catch(() => undefined);
        return {
          success: true,
          url,
          strategy: 'launch',
          verified: true,
          windowTitle: win.title,
          message: 'Chrome was not running; launched it once with your normal profile.',
        };
      }
    }
    return {
      success: false,
      url,
      strategy: 'launch',
      error: 'Chrome was started but no window appeared within 15 seconds.',
    };
  }

  /** Prefer the user's normal-profile Chrome over any debug-profile instance. */
  public async findPreferredChromeWindow(): Promise<WindowItem | null> {
    const windows = await this.apps.listRunningWindows().catch(() => [] as WindowItem[]);
    const chromeWins = windows.filter(
      (w) =>
        w.processName.toLowerCase() === 'chrome' &&
        (w.isVisible || w.isIconic) &&
        w.title.trim().length > 0,
    );
    if (chromeWins.length === 0) return null;
    const debugPids = await this.getDebugProfilePids();
    return chromeWins.find((w) => !debugPids.has(w.pid)) ?? chromeWins[0] ?? null;
  }

  private async getDebugProfilePids(): Promise<Set<number>> {
    if (this.debugPidsCache && this.now() - this.debugPidsCache.at < 15000) {
      return this.debugPidsCache.pids;
    }
    const pids = new Set<number>();
    try {
      const res = await this.apps.runSystemCommand(
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match '--user-data-dir' } | Select-Object -ExpandProperty ProcessId",
        { timeoutMs: 6000 },
      );
      if (res.ok) {
        for (const line of res.stdout.split(/\r?\n/)) {
          const n = Number(line.trim());
          if (Number.isFinite(n) && n > 0) pids.add(n);
        }
      }
    } catch {
      // If the query fails, treat all Chrome windows as user windows.
    }
    this.debugPidsCache = { at: this.now(), pids };
    return pids;
  }

  private async executeOnce(key: string, fn: () => Promise<OpenTabResult>): Promise<OpenTabResult> {
    const existing = this.inflight.get(key);
    if (existing) {
      const shared = await existing;
      return {
        ...shared,
        deduplicated: true,
        dedupNote:
          'An identical browser command was already in progress; its result was shared instead of opening another tab. Do NOT retry.',
      };
    }
    const cached = this.recent.get(key);
    if (cached && this.now() - cached.at < DEDUP_WINDOW_MS) {
      return {
        ...cached.result,
        deduplicated: true,
        dedupNote:
          'An identical browser command already completed moments ago; the duplicate was suppressed. Do NOT retry.',
      };
    }

    const promise = fn();
    this.inflight.set(key, promise);
    try {
      const result = await promise;
      this.recent.set(key, { at: this.now(), result });
      if (this.recent.size > 100) {
        const cutoff = this.now() - 60000;
        for (const [k, v] of this.recent) {
          if (v.at < cutoff) this.recent.delete(k);
        }
      }
      return result;
    } finally {
      this.inflight.delete(key);
    }
  }
}
