/**
 * Application adapters.
 *
 * The computer-use engine used to know about applications through three
 * parallel, disagreeing tables: an alias map, an if-chain of hard-coded
 * paths, and a memory store. None of them declared how to *verify* that the
 * application was actually running, or how to recover when it disappeared.
 *
 * An adapter is the missing contract: one object per application that knows
 * how to identify, launch, find, focus and verify its window. The registry
 * is consulted first by AppManagerService; an application without an adapter
 * falls back to the legacy resolution code, so nothing breaks while adapters
 * are added incrementally.
 */
import type { WindowItem, LaunchResult } from './types.js';
import type { BrowserGateway } from './browser-gateway.js';
import type { AppManagerService } from './app-manager.js';
import { findExecutableForApp } from './app-manager.js';

export interface ApplicationAdapter {
  readonly id: string;
  readonly targetApp: string;
  readonly aliases: readonly string[];
  isAvailable(): Promise<boolean>;
  launch(args?: string[]): Promise<LaunchResult>;
  findWindow(windows: WindowItem[]): WindowItem | undefined;
  focus(window: WindowItem): Promise<boolean>;
  verify(window: WindowItem): Promise<boolean>;
  /** Inspect the running instance and report whether it is still usable. */
  observe(windows: WindowItem[]): { running: boolean; window?: WindowItem; healthy: boolean };
  /** Attempt to bring the application back after a failure. */
  recover(reason: string, appManager: AppManagerService): Promise<boolean>;
}

export class ApplicationAdapterRegistry {
  private readonly adapters = new Map<string, ApplicationAdapter>();

  public register(adapter: ApplicationAdapter): void {
    this.adapters.set(adapter.id, adapter);
    for (const alias of adapter.aliases) this.adapters.set(alias.toLowerCase(), adapter);
    this.adapters.set(adapter.targetApp.toLowerCase(), adapter);
  }

  public resolve(name: string): ApplicationAdapter | undefined {
    return this.adapters.get(name.trim().toLowerCase());
  }

  public list(): ApplicationAdapter[] {
    return [...new Set(this.adapters.values())];
  }

  public has(name: string): boolean {
    return this.adapters.has(name.trim().toLowerCase());
  }
}

/** Build the default adapter set for an AppManagerService. */
export function buildDefaultAdapterRegistry(
  appManager: AppManagerService,
  browserGateway: BrowserGateway | undefined,
): ApplicationAdapterRegistry {
  const registry = new ApplicationAdapterRegistry();

  const simpleAdapter = (options: {
    id: string;
    targetApp: string;
    aliases: string[];
    processNames: string[];
  }): ApplicationAdapter => ({
    id: options.id,
    targetApp: options.targetApp,
    aliases: options.aliases,
    async isAvailable() {
      return findExecutableForApp(options.id) !== null;
    },
    async launch(args = []) {
      const resolved = findExecutableForApp(options.id);
      if (!resolved) {
        return { ok: false, appName: options.id, error: `${options.id} is not installed.` };
      }
      return appManager.launchDirect(
        resolved.exe,
        args.length > 0 ? args : resolved.defaultArgs,
        options.id,
        options.id,
      );
    },
    findWindow(windows) {
      return windows.find((w) => {
        const title = w.title.toLowerCase();
        const process = w.processName.toLowerCase();
        if (options.processNames.some((name) => process.includes(name))) return true;
        if (title.includes(options.targetApp.toLowerCase())) return true;
        return options.aliases.some((alias) => title.includes(alias.toLowerCase()));
      });
    },
    async focus(window) {
      return appManager.focusWindow(window.hwnd);
    },
    async verify(window) {
      return window.isVisible && !window.isIconic && Boolean(window.title.trim());
    },
    observe(windows) {
      const window = this.findWindow(windows);
      if (!window) return { running: false, healthy: false };
      const healthy = window.isVisible && !window.isIconic && window.title.trim().length > 0;
      return { running: true, window, healthy };
    },
    async recover(_reason, appManager) {
      const windows = await appManager.listRunningWindows().catch(() => [] as WindowItem[]);
      const window = this.findWindow(windows);
      if (window) return appManager.focusWindow(window.hwnd);
      // Relaunch as a last resort.
      const resolved = findExecutableForApp(options.id);
      if (!resolved) return false;
      const result = await appManager.launchDirect(
        resolved.exe,
        resolved.defaultArgs,
        options.id,
        options.id,
      );
      return result.ok;
    },
  });

  registry.register(
    simpleAdapter({
      id: 'notepad',
      targetApp: 'Notepad',
      aliases: ['notepad.exe'],
      processNames: ['notepad'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'explorer',
      targetApp: 'File Explorer',
      aliases: ['explorer.exe', 'files'],
      processNames: ['explorer'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'word',
      targetApp: 'Word',
      aliases: ['winword.exe', 'winword'],
      processNames: ['winword'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'excel',
      targetApp: 'Excel',
      aliases: ['excel.exe'],
      processNames: ['excel'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'powerpoint',
      targetApp: 'PowerPoint',
      aliases: ['powerpnt.exe', 'powerpnt'],
      processNames: ['powerpnt'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'vscode',
      targetApp: 'Visual Studio Code',
      aliases: ['code', 'code.cmd', 'vscode'],
      processNames: ['code'],
    }),
  );
  registry.register(
    simpleAdapter({
      id: 'edge',
      targetApp: 'Edge',
      aliases: ['msedge.exe', 'msedge', 'edge'],
      processNames: ['msedge'],
    }),
  );

  // Chrome goes through the browser gateway so it attaches to the running
  // instance instead of spawning a second Chrome.
  registry.register({
    id: 'chrome',
    targetApp: 'Google Chrome',
    aliases: ['chrome', 'chrome.exe', 'google chrome', 'browser'],
    async isAvailable() {
      return Boolean(browserGateway) || findExecutableForApp('chrome') !== null;
    },
    async launch(args = []) {
      if (browserGateway) {
        const url = args.find((a) => /^https?:\/\//i.test(a));
        const res = url ? await browserGateway.openTab(url) : await browserGateway.focusOrLaunch();
        return {
          ok: res.success,
          appName: 'chrome',
          windowTitle: res.windowTitle ?? (res.success ? 'Google Chrome' : undefined),
          verified: res.success,
          error: res.error,
        };
      }
      const resolved = findExecutableForApp('chrome');
      if (!resolved) return { ok: false, appName: 'chrome', error: 'chrome is not installed.' };
      return appManager.launchDirect(
        resolved.exe,
        args.length > 0 ? args : resolved.defaultArgs,
        'chrome',
        'chrome',
      );
    },
    findWindow(windows) {
      return windows.find((w) => {
        const title = w.title.toLowerCase();
        const process = w.processName.toLowerCase();
        return process.includes('chrome') && !title.includes('debug') && title.trim().length > 0;
      });
    },
    async focus(window) {
      return appManager.focusWindow(window.hwnd);
    },
    async verify(window) {
      return window.isVisible && !window.isIconic && window.title.trim().length > 0;
    },
    observe(windows) {
      const window = this.findWindow(windows);
      if (!window) return { running: false, healthy: false };
      const healthy = window.isVisible && !window.isIconic && window.title.trim().length > 0;
      return { running: true, window, healthy };
    },
    async recover(_reason, appManager) {
      const windows = await appManager.listRunningWindows().catch(() => [] as WindowItem[]);
      const window = this.findWindow(windows);
      if (window) return appManager.focusWindow(window.hwnd);
      if (browserGateway) {
        const res = await browserGateway.focusOrLaunch();
        return res.success;
      }
      const resolved = findExecutableForApp('chrome');
      if (!resolved) return false;
      const result = await appManager.launchDirect(resolved.exe, resolved.defaultArgs, 'chrome', 'chrome');
      return result.ok;
    },
  });

  return registry;
}

// Re-export the helper the AppManagerService uses for a direct spawn.
export { findExecutableForApp };
