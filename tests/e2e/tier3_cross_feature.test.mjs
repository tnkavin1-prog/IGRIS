/**
 * Tier 3: Cross-Feature Combinations Test Suite
 * Tests multi-engine integration and transactional data flows:
 * - TC-3.1: Full Autonomous Pipeline (Pack -> Inject -> Stream -> Detect -> Backup -> Sync -> Verify Disk)
 * - TC-3.2: Multi-File Batch Update with Concurrent Deletion (// DELETE_FILE:)
 * - TC-3.3: Dry-Run Mode Verification (Zero disk modifications, zero deletions, zero backups created)
 * - TC-3.4: Multi-Turn Sequential Modifications and Cascaded Rollbacks
 * - TC-3.5: CDP Disconnect & Reconnect Resilience
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MockCDPServer } from './mock-cdp-server.mjs';

// Dynamic imports
let packContext;
let ArenaCDPDriver;
let CodeSyncer, parseCodeBlocks;

try {
  const packerMod = await import('../../scripts/lib/context-packer.mjs');
  packContext = packerMod.packContext;
} catch (e) {}

try {
  const driverMod = await import('../../scripts/lib/arena-cdp-driver.mjs');
  ArenaCDPDriver = driverMod.ArenaCDPDriver;
} catch (e) {}

try {
  const syncerMod = await import('../../scripts/lib/code-syncer.mjs');
  CodeSyncer = syncerMod.CodeSyncer;
  parseCodeBlocks = syncerMod.parseCodeBlocks;
} catch (e) {}

export const name = 'Tier 3: Cross-Feature Combinations';

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
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-t3-'));
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
  // TC-3.1: Full Autonomous Pipeline
  // --------------------------------------------------------------------------
  await record(
    'TC-3.1: Full Pipeline (Pack -> Inject -> Stream -> Detect -> Backup -> Sync -> Verify Disk)',
    async () => {
      const sandbox = createSandbox();
      const mockServer = new MockCDPServer({ port: 9241, streamDelayMs: 25 });

      // Custom response refactoring calculator.ts
      const simulatedResponse = [
        'Refactoring math utility as requested:\n\n',
        '```typescript\n',
        '// FILE: src/utils/calculator.ts\n',
        'export function add(a: number, b: number): number {\n',
        '  return a + b;\n',
        '}\n\n',
        'export function multiply(a: number, b: number): number {\n',
        '  return a * b;\n',
        '}\n',
        '```\n\n',
        'Refactoring complete.',
      ].join('');

      mockServer.setScenario('custom', { customResponse: simulatedResponse });
      await mockServer.start();

      try {
        // 1. Initial workspace setup
        fs.mkdirSync(path.join(sandbox.dir, 'src', 'utils'), { recursive: true });
        const origCalcPath = path.join(sandbox.dir, 'src', 'utils', 'calculator.ts');
        fs.writeFileSync(origCalcPath, 'export function add(a: any, b: any) { return a + b; }');

        // 2. Stage 1: Context Packer
        const packed = await packContext({
          projectRoot: sandbox.dir,
          userPrompt: 'Upgrade calculator.ts to strict TypeScript with multiply helper',
        });
        assert.ok(
          packed.prompt.includes('calculator.ts'),
          'Prompt must contain target file context',
        );

        // 3. Stage 2: Arena CDP Driver connect & inject
        const driver = new ArenaCDPDriver({ port: 9241 });
        driver.on('error', () => {});
        await driver.connect();

        const injectRes = await driver.injectPrompt(packed.prompt);
        assert.equal(injectRes.success, true, 'Prompt injection must succeed');

        // 4. Stage 3: Submit prompt & wait for generation
        await driver.submitPrompt();
        const completion = await driver.waitForCompletion({
          pollIntervalMs: 15,
          debounceMs: 40,
          timeoutMs: 3000,
        });
        assert.ok(
          completion.text.includes('// FILE: src/utils/calculator.ts'),
          'Completion must return code block',
        );

        // 5. Stage 4: Code Syncer parses, backs up and writes
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });
        const blocks = syncer.parseCodeBlocks(completion.text);
        assert.equal(blocks.length, 1, 'Must parse exactly 1 file block');

        const syncResult = await syncer.sync(blocks);
        assert.ok(syncResult.backupTimestamp, 'Must create timestamped backup');

        // 6. Stage 5: Disk Verification
        const updatedContent = fs.readFileSync(origCalcPath, 'utf8');
        assert.ok(
          updatedContent.includes('export function multiply'),
          'Disk must reflect refactored code',
        );

        // Verify backup fidelity
        const backupPath = path.join(syncResult.backupDir, 'src', 'utils', 'calculator.ts');
        assert.ok(fs.existsSync(backupPath), 'Backup original file must exist');
        assert.equal(
          fs.readFileSync(backupPath, 'utf8'),
          'export function add(a: any, b: any) { return a + b; }',
          'Backup must retain exact original content',
        );

        await driver.disconnect();
      } finally {
        await mockServer.stop();
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-3.2: Multi-File Batch Update with Concurrent Deletion
  // --------------------------------------------------------------------------
  await record(
    'TC-3.2: Multi-File Batch Update with Concurrent Deletion (// DELETE_FILE:)',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Prepare initial workspace files
        fs.mkdirSync(path.join(sandbox.dir, 'pkg', 'src'), { recursive: true });
        fs.writeFileSync(
          path.join(sandbox.dir, 'pkg', 'src', 'math.ts'),
          'export const PI = 3.14;',
        );
        fs.writeFileSync(path.join(sandbox.dir, 'pkg', 'config.json'), '{"v": 1}');
        fs.writeFileSync(
          path.join(sandbox.dir, 'pkg', 'src', 'obsolete.ts'),
          'export const deadCode = true;',
        );

        // Model response containing 2 updates and 1 deletion
        const responseMarkdown = [
          'Applying multi-file refactor:\n\n',
          '```typescript\n',
          '// FILE: pkg/src/math.ts\n',
          'export const PI = 3.14159265359;\n',
          'export function square(x: number): number { return x * x; }\n',
          '```\n\n',
          '```json\n',
          '// FILE: pkg/config.json\n',
          '{\n',
          '  "v": 2,\n',
          '  "active": true\n',
          '}\n',
          '```\n\n',
          '```typescript\n',
          '// DELETE_FILE: pkg/src/obsolete.ts\n',
          '```\n',
        ].join('');

        const blocks = syncer.parseCodeBlocks(responseMarkdown);
        assert.equal(blocks.length, 3, 'Must parse 3 blocks');

        const syncRes = await syncer.sync(blocks);

        // Verify updates on disk
        assert.ok(
          fs
            .readFileSync(path.join(sandbox.dir, 'pkg', 'src', 'math.ts'), 'utf8')
            .includes('square'),
        );
        assert.equal(
          JSON.parse(fs.readFileSync(path.join(sandbox.dir, 'pkg', 'config.json'), 'utf8')).v,
          2,
        );

        // Verify deletion on disk
        assert.ok(
          !fs.existsSync(path.join(sandbox.dir, 'pkg', 'src', 'obsolete.ts')),
          'Deleted file must be removed from disk',
        );

        // Verify backup contains all 3 files
        const backupDir = syncRes.backupDir;
        assert.ok(
          fs.existsSync(path.join(backupDir, 'pkg', 'src', 'math.ts')),
          'math.ts backed up',
        );
        assert.ok(
          fs.existsSync(path.join(backupDir, 'pkg', 'config.json')),
          'config.json backed up',
        );
        assert.ok(
          fs.existsSync(path.join(backupDir, 'pkg', 'src', 'obsolete.ts')),
          'Deleted file backed up in session',
        );

        // Verify manifest records
        const manifest = syncRes.manifest;
        assert.equal(manifest.filesBackedUp.length, 3);
        assert.equal(manifest.deletedFiles.length, 1);
        assert.equal(manifest.deletedFiles[0].relative, 'pkg/src/obsolete.ts');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-3.3: Dry-Run Mode Verification
  // --------------------------------------------------------------------------
  await record(
    'TC-3.3: Dry-Run mode calculates plan without modifying, deleting, or backing up files',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Existing file
        fs.writeFileSync(path.join(sandbox.dir, 'keep.ts'), 'export const keep = 1;');
        fs.writeFileSync(path.join(sandbox.dir, 'remove.ts'), 'export const remove = 1;');

        const blocks = [
          { relativePath: 'keep.ts', content: 'export const keep = 2;' },
          { relativePath: 'remove.ts', isDelete: true },
          { relativePath: 'new.ts', content: 'export const brandNew = true;' },
        ];

        const dryRunRes = await syncer.sync(blocks, { dryRun: true });

        // Assert dryRun manifest
        assert.equal(dryRunRes.manifest.dryRun, true);
        assert.equal(dryRunRes.filesWritten.length, 2);
        assert.equal(dryRunRes.filesDeleted.length, 1);

        // Assert DISK IS 100% UNTOUCHED
        assert.equal(
          fs.readFileSync(path.join(sandbox.dir, 'keep.ts'), 'utf8'),
          'export const keep = 1;',
        );
        assert.ok(
          fs.existsSync(path.join(sandbox.dir, 'remove.ts')),
          'File marked for deletion must NOT be deleted',
        );
        assert.ok(
          !fs.existsSync(path.join(sandbox.dir, 'new.ts')),
          'New file must NOT be written to disk',
        );
        assert.ok(
          !fs.existsSync(syncer.backupDir),
          'Backup directory must NOT be created in dryRun',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // TC-3.4: Multi-Turn Sequential Pipeline & Cascaded Rollbacks
  // --------------------------------------------------------------------------
  await record('TC-3.4: Multi-Turn Sequential Modifications and Cascaded Rollbacks', async () => {
    const sandbox = createSandbox();
    try {
      const syncer = new CodeSyncer({
        projectRoot: sandbox.dir,
        backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
      });

      // Pristine state
      const targetFile = path.join(sandbox.dir, 'state.ts');
      fs.writeFileSync(targetFile, 'export const STATE = 0;');

      // Turn 1
      const turn1 = await syncer.sync([
        { relativePath: 'state.ts', content: 'export const STATE = 1;' },
      ]);
      assert.equal(fs.readFileSync(targetFile, 'utf8'), 'export const STATE = 1;');

      // Turn 2
      const turn2 = await syncer.sync([
        { relativePath: 'state.ts', content: 'export const STATE = 2;' },
        { relativePath: 'extra.ts', content: 'export const EXTRA = true;' },
      ]);
      assert.equal(fs.readFileSync(targetFile, 'utf8'), 'export const STATE = 2;');
      assert.ok(fs.existsSync(path.join(sandbox.dir, 'extra.ts')));

      // Rollback Turn 2 -> returns to Turn 1 state
      await syncer.rollback(turn2.backupTimestamp);
      assert.equal(
        fs.readFileSync(targetFile, 'utf8'),
        'export const STATE = 1;',
        'Rollback 2 must return to State 1',
      );
      assert.ok(
        !fs.existsSync(path.join(sandbox.dir, 'extra.ts')),
        'Extra file from Turn 2 must be removed',
      );

      // Rollback Turn 1 -> returns to initial pristine state
      await syncer.rollback(turn1.backupTimestamp);
      assert.equal(
        fs.readFileSync(targetFile, 'utf8'),
        'export const STATE = 0;',
        'Rollback 1 must return to Pristine State 0',
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // TC-3.5: CDP Disconnect & Reconnect Resilience
  // --------------------------------------------------------------------------
  await record('TC-3.5: CDP client gracefully reconnects after disconnection', async () => {
    const mockServer = new MockCDPServer({ port: 9245 });
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({ port: 9245 });
      driver.on('error', () => {});

      // Initial connection
      const c1 = await driver.connect();
      assert.equal(c1, true);
      assert.equal(driver.isConnected, true);

      // Disconnect
      await driver.disconnect();
      assert.equal(driver.isConnected, false);

      // Reconnect
      const c2 = await driver.connect();
      assert.equal(c2, true);
      assert.equal(driver.isConnected, true);

      // Verify command dispatch on reconnected socket
      const res = await driver.evaluate('5 * 5');
      assert.equal(res, 25);

      await driver.disconnect();
    } finally {
      await mockServer.stop();
    }
  })();

  return results;
}
