import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function findRepoRoot(): string {
  if (process.env.GEMATRON_ROOT && existsSync(process.env.GEMATRON_ROOT)) {
    return process.env.GEMATRON_ROOT;
  }
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'apps', 'desktop-hud')) && existsSync(join(dir, 'scripts'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();
export const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');
export const LOGS_DIR = join(REPO_ROOT, 'logs');
export const CHROME_PROFILE_DIR = join(REPO_ROOT, '.chrome-debug-profile');
export const BRIDGE_ENV_PATH = join(REPO_ROOT, 'apps', 'local-bridge', '.env');
export const DOWNLOADS_DIR = join(REPO_ROOT, 'downloads');
export const NOTES_DIR = join(REPO_ROOT, 'notes');

try {
  mkdirSync(LOGS_DIR, { recursive: true });
} catch {}
