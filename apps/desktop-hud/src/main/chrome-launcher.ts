import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class ChromeLauncher {
  private static readonly DEBUG_PORT = 9222;
  private static readonly PROFILE_DIR = 'E:\\Gematron\\.chrome-debug-profile';
  private static readonly DEFAULT_MOCK_URL = 'about:blank';

  public static findChromeExecutable(): string | null {
    const rawCandidates: Array<string | undefined> = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA
        ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env.PROGRAMFILES
        ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
      process.env['PROGRAMFILES(X86)']
        ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
        : undefined,
    ];

    const candidates = rawCandidates.filter(
      (c): c is string => typeof c === 'string' && existsSync(c),
    );
    return candidates[0] ?? null;
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

  public static async launch(
    targetUrl = ChromeLauncher.DEFAULT_MOCK_URL,
  ): Promise<{ ok: boolean; message: string }> {
    const alive = await this.isPortAvailable();
    if (alive) {
      return { ok: true, message: 'Chrome remote debugging is already active on port 9222.' };
    }

    const chromeExe = this.findChromeExecutable();
    if (!chromeExe) {
      return {
        ok: false,
        message: 'Google Chrome executable was not found. Please ensure Chrome is installed.',
      };
    }

    const args = [
      `--remote-debugging-port=${ChromeLauncher.DEBUG_PORT}`,
      `--user-data-dir=${ChromeLauncher.PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl,
    ];

    try {
      const child = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();

      // Wait up to 6 seconds for port 9222 to become available
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await this.isPortAvailable()) {
          return {
            ok: true,
            message: 'Google Chrome launched successfully with remote debugging.',
          };
        }
      }

      return {
        ok: false,
        message: 'Chrome process spawned, but remote debugging port 9222 did not respond in time.',
      };
    } catch (err) {
      return {
        ok: false,
        message: `Failed to spawn Chrome: ${(err as Error).message}`,
      };
    }
  }
}
