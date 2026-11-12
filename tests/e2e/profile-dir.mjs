/**
 * Browser profile directories for the end-to-end suite.
 *
 * Chromium writes roughly ten megabytes into every profile it is given, and
 * `launchPersistentContext` never removes that directory. Pointing the
 * profiles at the system temp directory filled the system drive with dozens
 * of stale folders, so they are created inside the repository's `temp/`
 * folder (which is ignored by git) and removed when the suite finishes.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const profileRoot = join(root, 'temp', 'e2e-profiles');

/** Create a throwaway Chromium profile directory. */
export function createProfileDir(prefix) {
  mkdirSync(profileRoot, { recursive: true });
  return mkdtempSync(join(profileRoot, `${prefix}-`));
}

/** Remove a profile directory and everything Chromium left in it. */
export function cleanupProfileDir(directory) {
  if (!directory) return;
  rmSync(directory, { recursive: true, force: true });
}
