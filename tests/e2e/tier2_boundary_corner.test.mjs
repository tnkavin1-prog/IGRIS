/**
 * Tier 2: Boundary & Corner Cases Test Suite
 * Tests hostile, boundary, and edge conditions:
 * - TC-2.1: Empty files (0 bytes) handling
 * - TC-2.2: Large files (>150KB) boundary and explicit override
 * - TC-2.3: Binary files with null-byte detection (boundary at 0, 511, and UTF-8 immunity)
 * - TC-2.4: Special characters and spaces in filenames and paths
 * - TC-2.5: Deep directory structures (>8 levels)
 * - TC-2.6: Unclosed markdown fences (throws IncompleteStreamingError)
 * - TC-2.7: Comprehensive path traversal attack variations
 * - TC-2.8: Existing vs Non-existing files in manifest tracking
 * - TC-2.9: Rollback edge cases (non-existent, corrupt manifest, missing target)
 * - TC-2.10: Pre-flight syntax failure aborts entire transaction
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Dynamic imports
let packContext, scanWorkspace, isBinaryFile;
let CodeSyncer, parseCodeBlocks, validateAndResolvePath, validateSyntax;

try {
  const packerMod = await import('../../scripts/lib/context-packer.mjs');
  packContext = packerMod.packContext;
  scanWorkspace = packerMod.scanWorkspace;
  isBinaryFile = packerMod.isBinaryFile;
} catch (e) {}

try {
  const syncerMod = await import('../../scripts/lib/code-syncer.mjs');
  CodeSyncer = syncerMod.CodeSyncer;
  parseCodeBlocks = syncerMod.parseCodeBlocks;
  validateAndResolvePath = syncerMod.validateAndResolvePath;
  validateSyntax = syncerMod.validateSyntax;
} catch (e) {}

export const name = 'Tier 2: Boundary & Corner Cases';

export async function run() {
  const results = [];

  function record(testName, fn) {
    return async () => {
      const start = Date.now();
      try {
        await fn();
        results.push({ name: testName, status: 'pass', durationMs: Date.now() - start });
      } catch (err) {
        results.push({
          name: testName,
          status: 'fail',
          error: err,
          durationMs: Date.now() - start,
        });
      }
    };
  }

  function createSandbox() {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-t2-'));
    return {
      dir: sandboxDir,
      cleanup: () => {
        try {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch {}
      },
    };
  }

  // --------------------------------------------------------------------------
  // TC-2.1: Empty files (0 bytes)
  // --------------------------------------------------------------------------
  await record('TC-2.1: Empty files (0 bytes) are packed and synced cleanly', async () => {
    const sandbox = createSandbox();
    try {
      const emptyFile = path.join(sandbox.dir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');

      // Context Packer handles 0-byte file
      const packed = await packContext({ projectRoot: sandbox.dir });
      assert.ok(
        packed.filesIncluded.includes('empty.txt'),
        'Empty file must be included in packing',
      );

      // CodeSyncer writes 0-byte file
      const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
      await syncer.sync([{ relativePath: 'created-empty.ts', content: '', isDelete: false }]);

      const created = path.join(sandbox.dir, 'created-empty.ts');
      assert.ok(fs.existsSync(created), 'Created empty file must exist');
      assert.equal(fs.statSync(created).size, 0, 'File size must be 0 bytes');
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // TC-2.2: Large files (>150KB) boundary & explicit target
  // --------------------------------------------------------------------------
  await record(
    'TC-2.2: Large files (>150KB) skipped in auto-crawl but included if targeted',
    async () => {
      const sandbox = createSandbox();
      try {
        const largeFile = path.join(sandbox.dir, 'large-spec.json');
        fs.writeFileSync(largeFile, JSON.stringify({ data: 'X'.repeat(160 * 1024) }));

        // Auto-crawl must skip
        const autoPacked = await packContext({ projectRoot: sandbox.dir });
        assert.ok(
          !autoPacked.filesIncluded.includes('large-spec.json'),
          'Auto-crawl must skip >150KB file',
        );

        // Explicit targetFiles must include
        const targetedPacked = await packContext({
          projectRoot: sandbox.dir,
          targetFiles: ['large-spec.json'],
          maxChars: 300000,
        });
        assert.ok(
          targetedPacked.filesIncluded.includes('large-spec.json'),
          'Explicit targetFiles includes large file',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.3: Binary file null-byte boundaries & UTF-8 immunity
  // --------------------------------------------------------------------------
  await record(
    'TC-2.3: Binary detection tests null bytes at bounds and protects UTF-8 text',
    async () => {
      // Null byte at index 0
      const leadingNull = Buffer.alloc(100);
      leadingNull[0] = 0x00;
      leadingNull.write('Hello', 1);
      assert.equal(
        isBinaryFile('sample.txt', leadingNull),
        true,
        'Null byte at offset 0 must be binary',
      );

      // Null byte at index 511 (512th byte boundary)
      const boundaryNull = Buffer.alloc(512);
      boundaryNull.fill(0x61); // 'a'
      boundaryNull[511] = 0x00;
      assert.equal(
        isBinaryFile('sample.txt', boundaryNull),
        true,
        'Null byte at offset 511 must be binary',
      );

      // Multi-byte Unicode UTF-8 text (emojis, CJK, Cyrillic) - must NOT be binary
      const unicodeText = Buffer.from('🚀 Gematron 宇宙 мир café résumé 123! \n\t');
      assert.equal(
        isBinaryFile('sample.txt', unicodeText),
        false,
        'Unicode UTF-8 text must NOT be classified as binary',
      );
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.4: Special characters and spaces in filenames
  // --------------------------------------------------------------------------
  await record('TC-2.4: Special characters and spaces in paths are safely handled', async () => {
    const sandbox = createSandbox();
    try {
      const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
      const specialPaths = [
        'src/folder with spaces/file with spaces.ts',
        'src/hyphen-name_v1.2.3.component.tsx',
        'config/app.dev-local.json',
      ];

      const blocks = [
        { relativePath: specialPaths[0], content: 'export const spaced = true;' },
        { relativePath: specialPaths[1], content: 'export const Hyphen = () => null;' },
        { relativePath: specialPaths[2], content: '{"port": 8080}' },
      ];

      const syncRes = await syncer.sync(blocks);
      assert.equal(syncRes.filesWritten.length, 3);

      for (const sp of specialPaths) {
        const full = path.join(sandbox.dir, sp);
        assert.ok(fs.existsSync(full), `File with special characters must exist: ${sp}`);
      }

      // Rollback test with special characters
      const rollbackRes = await syncer.rollback(syncRes.backupTimestamp);
      assert.equal(
        rollbackRes.removed.length,
        3,
        'Rollback must remove all newly created files with special characters',
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // TC-2.5: Deep directory structures (>8 levels)
  // --------------------------------------------------------------------------
  await record(
    'TC-2.5: Deep directory structures (>8 levels) are created and tracked',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });
        const deepPath = 'level1/level2/level3/level4/level5/level6/level7/level8/deep-module.ts';

        const syncRes = await syncer.sync([
          { relativePath: deepPath, content: 'export const depth = 8;' },
        ]);

        const fullDeepPath = path.join(sandbox.dir, deepPath);
        assert.ok(
          fs.existsSync(fullDeepPath),
          'Deeply nested file must be created with parent directories',
        );
        assert.equal(fs.readFileSync(fullDeepPath, 'utf8'), 'export const depth = 8;');

        // Update and verify deep backup structure
        const updateRes = await syncer.sync([
          { relativePath: deepPath, content: 'export const depth = 9;' },
        ]);

        const backedUpDeep = path.join(updateRes.backupDir, deepPath);
        assert.ok(fs.existsSync(backedUpDeep), 'Backup must mirror deep directory hierarchy');
        assert.equal(fs.readFileSync(backedUpDeep, 'utf8'), 'export const depth = 8;');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.6: Unclosed markdown fences
  // --------------------------------------------------------------------------
  await record(
    'TC-2.6: Incomplete or unclosed markdown fences throw error and halt parsing',
    async () => {
      const unclosedMarkdown = [
        'Here is the incomplete generation:\n\n',
        '```typescript\n',
        '// FILE: src/half.ts\n',
        'export function partial() {\n',
        '  console.log("no closing backticks");\n',
      ].join('');

      assert.throws(
        () => parseCodeBlocks(unclosedMarkdown),
        /Incomplete or unclosed markdown code fence/i,
        'Must throw error when backtick count is odd',
      );
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.7: Comprehensive path traversal attack variations
  // --------------------------------------------------------------------------
  await record(
    'TC-2.7: Security validator rejects all traversal and system escape vectors',
    async () => {
      const sandbox = createSandbox();
      try {
        const attackVectors = [
          '../escaped.txt',
          '../../escaped.txt',
          '../../../Windows/System32/drivers/etc/hosts',
          '..\\..\\Windows\\cmd.exe',
          'C:/Windows/win.ini',
          'D:\\database.sql',
          '\\\\attacker-smb\\share\\evil.bat',
          '//attacker-smb/share/evil.bat',
          '.git/config',
          '.git/hooks/pre-commit',
          '.env',
          '.env.production',
          'src/../../.env',
          'node_modules/express/index.js',
        ];

        for (const vector of attackVectors) {
          assert.throws(
            () => validateAndResolvePath(sandbox.dir, vector),
            /Security Violation/i,
            `Vector must be rejected: ${vector}`,
          );
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.8: Existing vs Non-existing files in manifest tracking
  // --------------------------------------------------------------------------
  await record(
    'TC-2.8: Existing files go to filesBackedUp; non-existing go to newFilesCreated',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // Create existing file
        fs.writeFileSync(path.join(sandbox.dir, 'exists.ts'), 'export const existing = 1;');

        const syncRes = await syncer.sync([
          { relativePath: 'exists.ts', content: 'export const existing = 2;' },
          { relativePath: 'brand-new.ts', content: 'export const fresh = 3;' },
        ]);

        const manifest = syncRes.manifest;
        assert.equal(manifest.filesBackedUp.length, 1);
        assert.equal(manifest.filesBackedUp[0].relative, 'exists.ts');

        assert.equal(manifest.newFilesCreated.length, 1);
        assert.equal(manifest.newFilesCreated[0], 'brand-new.ts');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.9: Rollback edge cases
  // --------------------------------------------------------------------------
  await record(
    'TC-2.9: Rollback edge cases handle missing timestamps, corrupted manifests, and deletions',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // 1. Non-existent timestamp
        await assert.rejects(
          () => syncer.rollback('1999-01-01_00-00-00-000'),
          /Backup manifest not found/i,
          'Must reject non-existent timestamp',
        );

        // 2. Corrupted manifest (invalid JSON)
        const corruptDir = path.join(syncer.backupDir, 'corrupt-session');
        fs.mkdirSync(corruptDir, { recursive: true });
        fs.writeFileSync(path.join(corruptDir, 'manifest.json'), '{ invalid json syntax');

        await assert.rejects(
          () => syncer.rollback('corrupt-session'),
          /SyntaxError|JSON/i,
          'Must fail on corrupt manifest',
        );

        // 3. Rollback when new file was already manually removed from disk
        fs.writeFileSync(path.join(sandbox.dir, 'tracked.ts'), 'original');
        const syncRes = await syncer.sync([
          { relativePath: 'tracked.ts', content: 'updated' },
          { relativePath: 'will-delete-manually.ts', content: 'manual' },
        ]);

        // Manually delete the new file before rollback
        fs.unlinkSync(path.join(sandbox.dir, 'will-delete-manually.ts'));

        // Rollback must succeed without ENOENT error
        const rollbackRes = await syncer.rollback(syncRes.backupTimestamp);
        assert.ok(rollbackRes.restored.includes('tracked.ts'), 'Must restore tracked.ts');
        assert.equal(fs.readFileSync(path.join(sandbox.dir, 'tracked.ts'), 'utf8'), 'original');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-2.10: Pre-flight syntax failure aborts entire transaction
  // --------------------------------------------------------------------------
  await record(
    'TC-2.10: Pre-flight syntax error in any file aborts entire transaction without disk changes',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({ projectRoot: sandbox.dir });

        // Initial clean file
        fs.writeFileSync(path.join(sandbox.dir, 'clean.ts'), 'export const untouched = true;');

        const blocks = [
          { relativePath: 'clean.ts', content: 'export const untouched = false;' },
          { relativePath: 'syntax-error.ts', content: 'const broken = ((\n' }, // Broken syntax
        ];

        await assert.rejects(
          () => syncer.sync(blocks),
          /Syntax validation failed for "syntax-error.ts"/i,
          'Must reject batch containing invalid syntax',
        );

        // Verify that clean.ts was NEVER modified
        assert.equal(
          fs.readFileSync(path.join(sandbox.dir, 'clean.ts'), 'utf8'),
          'export const untouched = true;',
          'File must remain completely untouched after transaction abort',
        );

        // Verify that syntax-error.ts was NEVER created
        assert.ok(
          !fs.existsSync(path.join(sandbox.dir, 'syntax-error.ts')),
          'Syntax error file must not be created',
        );

        // Verify that no backup folder was created
        assert.ok(
          !fs.existsSync(syncer.backupDir),
          'Backup directory must not be created on pre-flight failure',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  return results;
}
