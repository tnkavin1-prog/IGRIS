import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, parse, resolve } from 'node:path';

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

/**
 * Pick the directory that holds the application's writable state.
 *
 * The storage policy forbids the system drive: an application installed on
 * E: must not scatter its logs, notes, downloads and browser profile over
 * C:. The data root therefore follows the drive the application lives on,
 * and only falls back to %LOCALAPPDATA% when that drive *is* C: and the
 * caller has not configured anything better.
 *
 * Exported as a pure function so the policy can be tested without touching
 * the filesystem.
 */
export function pickDataRoot(options: {
  env?: NodeJS.ProcessEnv;
  packaged: boolean;
  repoRoot: string;
  execPath: string;
  localAppData?: string;
  home?: string;
}): string {
  const env = options.env ?? process.env;
  const override = env.GEMATRON_DATA_DIR;
  if (override && override.trim()) return resolve(override.trim());

  if (!options.packaged) return resolve(options.repoRoot);

  const installDrive = parse(options.execPath).root;
  if (!/^c:\\$/i.test(installDrive)) {
    // The install drive is not C: - keep the state beside the application.
    return join(installDrive, 'GemetronData');
  }
  const localAppData =
    options.localAppData ?? env.LOCALAPPDATA ?? join(options.home ?? homedir(), 'AppData', 'Local');
  return join(localAppData, 'Gemetron');
}

// Installed builds keep writable state beside the application; dev builds keep
// it in the repository. GEMATRON_DATA_DIR always wins.
export const DATA_ROOT = pickDataRoot({
  env: process.env,
  packaged: IS_PACKAGED,
  repoRoot: REPO_ROOT,
  execPath: process.execPath,
  localAppData: process.env.LOCALAPPDATA,
  home: homedir(),
});

export const SCRIPTS_DIR = IS_PACKAGED
  ? join(resourcesDir(), 'scripts')
  : join(REPO_ROOT, 'scripts');
export const ASSETS_DIR = IS_PACKAGED ? join(resourcesDir(), 'assets') : join(REPO_ROOT, 'assets');
export const LOGS_DIR = join(DATA_ROOT, 'logs');
export const TEMP_DIR = join(DATA_ROOT, 'temp');
export const DOWNLOADS_DIR = join(DATA_ROOT, 'downloads');
export const NOTES_DIR = join(DATA_ROOT, 'notes');
export const CHROME_PROFILE_DIR = join(DATA_ROOT, '.chrome-debug-profile');

// Electron's own profile (caches, cookies, localStorage). Development builds
// keep it under a dot-directory so a run never litters the repository root
// with Chromium cache files.
export const ELECTRON_USER_DATA_DIR = IS_PACKAGED
  ? join(DATA_ROOT, 'electron')
  : join(DATA_ROOT, '.runtime', 'electron');
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
