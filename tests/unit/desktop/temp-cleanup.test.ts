import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupTempDir } from '../../../apps/desktop-hud/src/main/temp-cleanup.js';

describe('temp cleanup', () => {
  it('removes files older than the threshold and keeps fresh ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemetron-temp-'));
    const oldFile = join(dir, 'old.txt');
    const freshFile = join(dir, 'fresh.txt');
    writeFileSync(oldFile, 'old content');
    writeFileSync(freshFile, 'fresh content');
    // Age the old file by touching its mtime 2 days ago.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(oldFile, twoDaysAgo, twoDaysAgo);

    const result = cleanupTempDir(dir, 24 * 60 * 60 * 1000);
    expect(result.removedFiles).toBe(1);
    expect(result.bytesFreed).toBeGreaterThan(0);

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('removes old directories recursively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gemetron-temp-'));
    const oldDir = join(dir, 'old-dir');
    mkdirSync(oldDir);
    writeFileSync(join(oldDir, 'inner.txt'), 'data');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(oldDir, twoDaysAgo, twoDaysAgo);

    const result = cleanupTempDir(dir, 24 * 60 * 60 * 1000);
    expect(result.removedDirs).toBe(1);

    expect(existsSync(oldDir)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('returns zeros for an empty or missing directory', () => {
    const result = cleanupTempDir(join(tmpdir(), 'definitely-missing-gemetron-dir'), 1000);
    expect(result.removedFiles).toBe(0);
    expect(result.removedDirs).toBe(0);
    expect(result.bytesFreed).toBe(0);
  });
});
