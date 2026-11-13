/**
 * Temp-directory hygiene.
 *
 * The screen stream, the PDF reader, the video reader and the Office skill
 * all write scratch files under TEMP_DIR. Without cleanup that directory
 * grows without bound, which matters on the small drives the app targets.
 *
 * cleanupTempDir removes files and directories older than `maxAgeMs` and
 * reports how much was freed. It never throws: a locked file is skipped.
 */
import { readdirSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { TEMP_DIR } from './runtime-paths.js';
import { logger } from './errors.js';

export interface TempCleanupResult {
  removedFiles: number;
  removedDirs: number;
  bytesFreed: number;
  skipped: number;
}

export function cleanupTempDir(
  dir: string = TEMP_DIR,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): TempCleanupResult {
  const result: TempCleanupResult = {
    removedFiles: 0,
    removedDirs: 0,
    bytesFreed: 0,
    skipped: 0,
  };
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return result;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      result.skipped++;
      continue;
    }
    if (stat.mtimeMs >= cutoff) continue;
    try {
      if (stat.isDirectory()) {
        // Measure before removing.
        const size = directorySize(full);
        rmSync(full, { recursive: true, force: true });
        result.removedDirs++;
        result.bytesFreed += size;
      } else {
        unlinkSync(full);
        result.removedFiles++;
        result.bytesFreed += stat.size;
      }
    } catch (error) {
      result.skipped++;
      logger.warn('Could not remove temp entry', { path: full, error: String(error) });
    }
  }
  return result;
}

function directorySize(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) total += directorySize(full);
      else total += stat.size;
    }
  } catch {
    /* best effort */
  }
  return total;
}
