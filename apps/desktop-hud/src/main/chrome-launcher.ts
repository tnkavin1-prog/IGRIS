import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_PROFILE_DIR } from './runtime-paths.js';

export class ChromeLauncher {
  private static readonly DEBUG_PORT = 9222;
  private static cachedExe: string | null = null;

  public static findChromeExecutable(): string | null {
    if (this.cachedExe && existsSync(this.cachedExe)) return this.cachedExe;
    const candidates = [
      process.env.PROGRAMFILES
        ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env['PROGRAMFILES(X86)']
        ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter((c): c is string => typeof c === 'string' && existsSync(c));
    this.cachedExe = candidates[0] ?? null;
    return this.cachedExe;
  }

  public static findChromeViaRegistry(): Promise<string | null> {
    const keys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
    ];
    return new Promise((resolve) => {
      let pending = keys.length;
      let found: string | null = null;
      for (const key of keys) {
        execFile(
          'reg',
          ['query', key, '/ve'],
          { timeout: 3000, windowsHide: true },
          (err, stdout) => {
            if (!err && !found) {
              const m = stdout.match(/REG_SZ\s+(.+\.exe)\s*$/im);
              if (m && m[1] && existsSync(m[1].trim())) found = m[1].trim();
            }
            if (--pending === 0) resolve(found);
          },
        );
      }
    });
  }

  public static async isPortAvailable(port = ChromeLauncher.DEBUG_PORT): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1200),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Open a tab in the already-running debug Chrome via the HTTP endpoint. */
  public static async openTab(url: string): Promise<boolean> {
    try {
      const res = await fetch(
        `http://127.0.0.1:${ChromeLauncher.DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
        { method: 'PUT', signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) return true;
    } catch {}
    // No GET retry: a PUT that succeeded but timed out would create a second tab.
    return false;
  }

  private static async spawnWithProfile(
    exe: string,
    profileDir: string,
    targetUrl: string,
  ): Promise<boolean> {
    mkdirSync(profileDir, { recursive: true });
    const child = spawn(
      exe,
      [
        `--remote-debugging-port=${ChromeLauncher.DEBUG_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        targetUrl,
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      if (await this.isPortAvailable()) return true;
    }
    return false;
  }

  public static async launch(targetUrl = 'about:blank'): Promise<{ ok: boolean; message: string }> {
    if (await this.isPortAvailable()) {
      if (targetUrl && targetUrl !== 'about:blank') await this.openTab(targetUrl);
      return { ok: true, message: 'Chrome is already active with remote debugging on port 9222.' };
    }

    const exe = this.findChromeExecutable() ?? (await this.findChromeViaRegistry());
    if (!exe) {
      return {
        ok: false,
        message:
          'Chrome was not found (checked standard folders and the registry). Is it installed?',
      };
    }
    this.cachedExe = exe;

    if (await this.spawnWithProfile(exe, CHROME_PROFILE_DIR, targetUrl)) {
      return { ok: true, message: 'Chrome launched; remote debugging verified on port 9222.' };
    }

    // No "-fresh" second spawn: it used to open a second new window with the
    // same URL, producing duplicate tabs. Fail honestly instead.
    return {
      ok: false,
      message:
        'Chrome started but its debugging port never opened. Close ALL Chrome windows (including background apps in the system tray) and try again.',
    };
  }
}
