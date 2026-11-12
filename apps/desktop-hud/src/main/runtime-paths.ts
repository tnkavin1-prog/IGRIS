import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const MODULE_DIR = typeof __dirname === 'string' ? __dirname : process.cwd();

export const IS_PACKAGED = /app\.asar/i.test(MODULE_DIR);

function findRepoRoot(): string {
  if (process.env.GEMATRON_ROOT && existsSync(process.env.GEMATRON_ROOT)) {
    return process.env.GEMATRON_ROOT;
  }
  let dir = MODULE_DIR;
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

function resourcesDir(): string {
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return res || dirname(MODULE_DIR);
}

export const REPO_ROOT = findRepoRoot();

// Installed builds keep writable state in %LOCALAPPDATA%\Gemetron; dev builds keep it in the repo.
export const DATA_ROOT =
  process.env.GEMATRON_DATA_DIR ||
  (IS_PACKAGED
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Gemetron')
    : REPO_ROOT);

export const SCRIPTS_DIR = IS_PACKAGED
  ? join(resourcesDir(), 'scripts')
  : join(REPO_ROOT, 'scripts');
export const ASSETS_DIR = IS_PACKAGED ? join(resourcesDir(), 'assets') : join(REPO_ROOT, 'assets');
export const LOGS_DIR = join(DATA_ROOT, 'logs');
export const TEMP_DIR = join(DATA_ROOT, 'temp');
export const DOWNLOADS_DIR = join(DATA_ROOT, 'downloads');
export const NOTES_DIR = join(DATA_ROOT, 'notes');
export const CHROME_PROFILE_DIR = join(DATA_ROOT, '.chrome-debug-profile');
export const BRIDGE_ENV_PATH = IS_PACKAGED
  ? join(DATA_ROOT, '.env')
  : join(REPO_ROOT, 'apps', 'local-bridge', '.env');
export const ICON_PATH = join(ASSETS_DIR, 'icons', 'jarvis.ico');

for (const dir of [LOGS_DIR, TEMP_DIR]) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only media: callers handle their own write failures */
  }
}
