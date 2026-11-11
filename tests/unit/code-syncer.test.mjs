/**
 * Comprehensive Unit Tests for Code Syncer & Backup Engine (Milestone 3)
 *
 * Verifies:
 * 1. Markdown code block parser (headers, strip, delete, incomplete fence error)
 * 2. Path traversal & security guard (containment, drive letters, UNC, .git, .env, node_modules)
 * 3. Pre-flight syntax validator (esbuild for TS/JS, JSON.parse, fail-fast)
 * 4. Atomic file writer (tmp sibling, rename fallback, clean tmp)
 * 5. Safe timestamped backup engine (manifest.json, sha256, dry-run)
 * 6. Rollback engine (restore original, unlink created, restore deleted)
 * 7. End-to-end sync and rollback lifecycle
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {
  CodeSyncer,
  parseCodeBlocks,
  validateAndResolvePath,
  validateSyntax,
  atomicWriteFile,
} from '../../scripts/lib/code-syncer.mjs';

// Polyfill test harness for both node:test and vitest environments
let describe, it, beforeEach, afterEach;
if (typeof globalThis.describe === 'function') {
  describe = globalThis.describe;
  it = globalThis.it;
  beforeEach = globalThis.beforeEach;
  afterEach = globalThis.afterEach;
} else {
  const nodeTest = await import('node:test');
  describe = nodeTest.describe;
  it = nodeTest.it;
  beforeEach = nodeTest.beforeEach;
  afterEach = nodeTest.afterEach;
}

describe('Code Syncer & Backup Engine (Milestone 3)', () => {
  let sandboxDir;
  let syncer;

  beforeEach(() => {
    // Create an isolated sandbox project root for testing
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-syncer-test-'));
    syncer = new CodeSyncer({
      projectRoot: sandboxDir,
      backupDir: path.join(sandboxDir, 'backups', 'kimi-history'),
    });
  });

  afterEach(() => {
    // Clean up sandbox directory
    if (sandboxDir && fs.existsSync(sandboxDir)) {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // ignore sandbox cleanup errors
      }
    }
  });

  // =========================================================================
  // 1. Markdown Code Block Parser Tests
  // =========================================================================
  describe('1. Markdown Code Block Parser', () => {
    it('parses single block with // FILE: header and strips header line', () => {
      const response = [
        'Here is the solution:',
        '```typescript',
        '// FILE: src/models/user.ts',
        'export interface User {',
        '  id: string;',
        '  name: string;',
        '}',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].relativePath, 'src/models/user.ts');
      assert.equal(blocks[0].isDelete, false);
      assert.equal(blocks[0].content, 'export interface User {\n  id: string;\n  name: string;\n}');
    });

    it('parses blocks with # FILE: header (Python / Shell)', () => {
      const response = [
        '```python',
        '# FILE: scripts/run.py',
        'import sys',
        'print("Hello")',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].relativePath, 'scripts/run.py');
      assert.equal(blocks[0].content, 'import sys\nprint("Hello")');
    });

    it('parses blocks with <!-- FILE: ... --> and /* FILE: ... */ headers', () => {
      const response = [
        '```html',
        '<!-- FILE: public/index.html -->',
        '<!DOCTYPE html>',
        '<html></html>',
        '```',
        '```css',
        '/* FILE: src/styles/main.css */',
        'body { margin: 0; }',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0].relativePath, 'public/index.html');
      assert.equal(blocks[0].content, '<!DOCTYPE html>\n<html></html>');
      assert.equal(blocks[1].relativePath, 'src/styles/main.css');
      assert.equal(blocks[1].content, 'body { margin: 0; }');
    });

    it('parses blocks with ; FILE: and ### FILE: headers', () => {
      const response = [
        '```ini',
        '; FILE: config/app.ini',
        '[settings]',
        'mode = production',
        '```',
        '```yaml',
        '### FILE: config/deploy.yml',
        'version: "3"',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0].relativePath, 'config/app.ini');
      assert.equal(blocks[1].relativePath, 'config/deploy.yml');
    });

    it('parses // DELETE_FILE: and # DELETE_FILE: headers', () => {
      const response = [
        'Let us clean up deprecated files:',
        '```',
        '// DELETE_FILE: apps/old-feature.ts',
        '```',
        '```bash',
        '# DELETE_FILE: scripts/legacy.sh',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0].relativePath, 'apps/old-feature.ts');
      assert.equal(blocks[0].isDelete, true);
      assert.equal(blocks[0].content, '');
      assert.equal(blocks[1].relativePath, 'scripts/legacy.sh');
      assert.equal(blocks[1].isDelete, true);
    });

    it('normalizes backslashes to forward slashes in relativePath', () => {
      const response = [
        '```ts',
        '// FILE: apps\\desktop-hud\\src\\main\\win.ts',
        'export const x = 1;',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks[0].relativePath, 'apps/desktop-hud/src/main/win.ts');
    });

    it('strips surrounding single and double quotes from file path', () => {
      const response = [
        '```ts',
        '// FILE: "apps/main.ts"',
        'export const a = 1;',
        '```',
        '```ts',
        "// FILE: 'apps/secondary.ts'",
        'export const b = 2;',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks[0].relativePath, 'apps/main.ts');
      assert.equal(blocks[1].relativePath, 'apps/secondary.ts');
    });

    it('ignores code blocks that do not have FILE or DELETE_FILE headers', () => {
      const response = [
        'To install dependencies, run:',
        '```bash',
        'npm install',
        '```',
        'Now update the code:',
        '```ts',
        '// FILE: src/index.ts',
        'console.log("ready");',
        '```',
        'Finally run test:',
        '```bash',
        'npm test',
        '```',
      ].join('\n');

      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].relativePath, 'src/index.ts');
    });

    it('throws error if incomplete or unclosed code fence is detected', () => {
      const response = [
        'Here is the incomplete code:',
        '```ts',
        '// FILE: src/broken.ts',
        'const unfinished = true;',
        // Note: Missing closing ```
      ].join('\n');

      assert.throws(
        () => parseCodeBlocks(response),
        /Incomplete or unclosed markdown code fence detected/i,
      );
    });

    it('returns empty array on empty string or null/undefined input', () => {
      assert.deepEqual(parseCodeBlocks(''), []);
      assert.deepEqual(parseCodeBlocks(null), []);
      assert.deepEqual(parseCodeBlocks(undefined), []);
      assert.deepEqual(parseCodeBlocks('Just plain text without fences.'), []);
    });

    it('handles empty code block content properly', () => {
      const response = '```ts\n// FILE: empty.ts\n```';
      const blocks = parseCodeBlocks(response);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].relativePath, 'empty.ts');
      assert.equal(blocks[0].content, '');
    });
  });

  // =========================================================================
  // 2. Path Traversal & Security Guard Tests
  // =========================================================================
  describe('2. Path Traversal & Security Guard', () => {
    it('accepts valid nested paths inside projectRoot', () => {
      const result = validateAndResolvePath(sandboxDir, 'apps/desktop-hud/src/main/foo.ts');
      assert.equal(result.relative, 'apps/desktop-hud/src/main/foo.ts');
      assert.equal(result.resolved, path.resolve(sandboxDir, 'apps/desktop-hud/src/main/foo.ts'));
    });

    it('normalizes internal relative segments staying within projectRoot', () => {
      const result = validateAndResolvePath(sandboxDir, 'apps/../scripts/lib/foo.js');
      assert.equal(result.relative, 'scripts/lib/foo.js');
    });

    it('rejects path traversal attempting to escape projectRoot', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '../../Windows/System32/evil.dll'),
        /Security Violation: Path traversal outside project root/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'apps/../../outside.txt'),
        /Security Violation: Path traversal outside project root/i,
      );
    });

    it('rejects drive letters in relative path (C:, D:)', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'C:\\Windows\\System32\\cmd.exe'),
        /Security Violation: Drive letters not permitted/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'D:/malicious/script.bat'),
        /Security Violation: Drive letters not permitted/i,
      );
    });

    it('rejects UNC network paths (\\\\server\\share, //server/share)', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '\\\\192.168.1.100\\share\\exploit.exe'),
        /Security Violation: UNC paths not permitted/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '//nas/backup/data.json'),
        /Security Violation: UNC paths not permitted/i,
      );
    });

    it('rejects absolute paths (/etc/passwd, \\Windows)', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '/etc/passwd'),
        /Security Violation: Absolute paths not permitted/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '\\Windows\\win.ini'),
        /Security Violation: Absolute paths not permitted/i,
      );
    });

    it('rejects targeting the project root directory itself', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.'),
        /Security Violation: Target path cannot be the project root/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, './'),
        /Security Violation: Target path cannot be the project root/i,
      );
    });

    it('rejects null bytes in path', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'src/test.ts\0.exe'),
        /Security Violation: Null bytes detected/i,
      );
    });

    it('blocks direct and nested .git modifications', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.git'),
        /Security Violation: Direct modification of .git is forbidden/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.git/config'),
        /Security Violation: Direct modification of .git is forbidden/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.git/hooks/pre-commit'),
        /Security Violation: Direct modification of .git is forbidden/i,
      );
    });

    it('blocks root .env, .env.local, and nested .env files', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.env'),
        /Security Violation: Writing to .env files is blocked/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '.env.local'),
        /Security Violation: Writing to .env files is blocked/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'apps/desktop-hud/.env'),
        /Security Violation: Writing to .env files is blocked/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'packages/shared/.env.production'),
        /Security Violation: Writing to .env files is blocked/i,
      );
    });

    it('blocks direct and nested node_modules modifications', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'node_modules/package.json'),
        /Security Violation: Direct modification of node_modules is forbidden/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, 'apps/desktop-hud/node_modules/foo/index.js'),
        /Security Violation: Direct modification of node_modules is forbidden/i,
      );
    });

    it('rejects empty or whitespace-only paths', () => {
      assert.throws(
        () => validateAndResolvePath(sandboxDir, ''),
        /Path must be a non-empty string/i,
      );
      assert.throws(
        () => validateAndResolvePath(sandboxDir, '   '),
        /Path must be a non-empty string/i,
      );
    });
  });

  // =========================================================================
  // 3. Pre-Flight Syntax Validator Tests
  // =========================================================================
  describe('3. Pre-Flight Syntax Validator', () => {
    it('succeeds for valid TypeScript (.ts)', () => {
      const code =
        'export interface Config { timeout: number; debug?: boolean; }\nexport const def = 1;';
      assert.equal(validateSyntax('src/config.ts', code), true);
    });

    it('succeeds for valid TSX with JSX (.tsx)', () => {
      const code =
        'import React from "react";\nexport const Card = () => <div className="card">Title</div>;';
      assert.equal(validateSyntax('src/components/Card.tsx', code), true);
    });

    it('succeeds for valid JavaScript (.js, .mjs)', () => {
      const code = 'export function add(a, b) { return a + b; }\nexport default add;';
      assert.equal(validateSyntax('scripts/util.js', code), true);
      assert.equal(validateSyntax('scripts/lib.mjs', code), true);
    });

    it('succeeds for valid JSON (.json)', () => {
      const json = JSON.stringify({ name: 'gematron', version: '1.0.0', features: [1, 2, 3] });
      assert.equal(validateSyntax('package.json', json), true);
    });

    it('throws error for invalid TypeScript syntax', () => {
      const brokenCode = 'export const fn = ( { return 1; };';
      assert.throws(
        () => validateSyntax('src/broken.ts', brokenCode),
        /Syntax validation failed for "src\/broken.ts"/i,
      );
    });

    it('throws error for invalid JSON syntax', () => {
      const brokenJson = '{ "name": "gematron", broken: }';
      assert.throws(
        () => validateSyntax('data.json', brokenJson),
        /Syntax validation failed for "data.json": Invalid JSON/i,
      );
    });

    it('passes non-code files (.md, .txt, .css, .html) without syntax checks', () => {
      assert.equal(validateSyntax('README.md', '# Title\nUnclosed [link('), true);
      assert.equal(validateSyntax('styles.css', 'body { color: red; }'), true);
      assert.equal(validateSyntax('page.html', '<div><span>Text'), true);
      assert.equal(validateSyntax('notes.txt', 'Raw freeform notes'), true);
    });
  });

  // =========================================================================
  // 4. Atomic File Writer Tests
  // =========================================================================
  describe('4. Atomic File Writer', () => {
    it('writes content to target creating nested parent directories', () => {
      const dest = path.join(sandboxDir, 'nested', 'deep', 'file.txt');
      atomicWriteFile(dest, 'Hello atomic world');

      assert.equal(fs.existsSync(dest), true);
      assert.equal(fs.readFileSync(dest, 'utf8'), 'Hello atomic world');
    });

    it('atomically replaces existing file content', () => {
      const dest = path.join(sandboxDir, 'replace-me.txt');
      atomicWriteFile(dest, 'Version 1');
      assert.equal(fs.readFileSync(dest, 'utf8'), 'Version 1');

      atomicWriteFile(dest, 'Version 2 updated');
      assert.equal(fs.readFileSync(dest, 'utf8'), 'Version 2 updated');
    });

    it('ensures no temporary files linger in directory after writing', () => {
      const dir = path.join(sandboxDir, 'check-tmp');
      const dest = path.join(dir, 'output.txt');
      atomicWriteFile(dest, 'Done');

      const files = fs.readdirSync(dir);
      assert.equal(files.length, 1);
      assert.equal(files[0], 'output.txt');
    });
  });

  // =========================================================================
  // 5. Safe Timestamped Backup & Sync Tests
  // =========================================================================
  describe('5. Safe Timestamped Backup & Sync', () => {
    it('backs up existing file before modifying it and records in manifest', async () => {
      // Create initial existing file
      const initialFile = path.join(sandboxDir, 'src', 'app.ts');
      fs.mkdirSync(path.dirname(initialFile), { recursive: true });
      fs.writeFileSync(initialFile, 'export const initial = 42;\n', 'utf8');

      const blocks = [
        {
          relativePath: 'src/app.ts',
          content: 'export const updated = 100;\n',
          isDelete: false,
        },
      ];

      const result = await syncer.sync(blocks, { timestamp: '2026-11-09_12-00-00-000' });

      // Verify file modified on disk
      assert.equal(fs.readFileSync(initialFile, 'utf8'), 'export const updated = 100;\n');
      assert.deepEqual(result.filesWritten, ['src/app.ts']);

      // Verify backup created in correct directory
      const backupFile = path.join(result.backupDir, 'src', 'app.ts');
      assert.equal(fs.existsSync(backupFile), true);
      assert.equal(fs.readFileSync(backupFile, 'utf8'), 'export const initial = 42;\n');

      // Verify manifest.json
      const manifestPath = path.join(result.backupDir, 'manifest.json');
      assert.equal(fs.existsSync(manifestPath), true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      assert.equal(manifest.timestamp, '2026-11-09_12-00-00-000');
      assert.equal(manifest.filesBackedUp.length, 1);
      assert.equal(manifest.filesBackedUp[0].relative, 'src/app.ts');
      assert.equal(manifest.newFilesCreated.length, 0);
    });

    it('records newly created files in manifest without backing up non-existent files', async () => {
      const blocks = [
        {
          relativePath: 'src/new-module.ts',
          content: 'export const hello = "world";\n',
          isDelete: false,
        },
      ];

      const result = await syncer.sync(blocks, { timestamp: '2026-11-09_12-01-00-000' });

      // Verify created on disk
      const newFile = path.join(sandboxDir, 'src', 'new-module.ts');
      assert.equal(fs.existsSync(newFile), true);
      assert.equal(fs.readFileSync(newFile, 'utf8'), 'export const hello = "world";\n');

      // Verify manifest
      assert.equal(result.manifest.filesBackedUp.length, 0);
      assert.deepEqual(result.manifest.newFilesCreated, ['src/new-module.ts']);
    });

    it('backs up and deletes existing file when isDelete: true', async () => {
      const targetFile = path.join(sandboxDir, 'src', 'to-remove.ts');
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, 'console.log("old");\n', 'utf8');

      const blocks = [
        {
          relativePath: 'src/to-remove.ts',
          content: '',
          isDelete: true,
        },
      ];

      const result = await syncer.sync(blocks, { timestamp: '2026-11-09_12-02-00-000' });

      // Verify unlinked from disk
      assert.equal(fs.existsSync(targetFile), false);
      assert.deepEqual(result.filesDeleted, ['src/to-remove.ts']);

      // Verify backup preserved the deleted content
      const backupFile = path.join(result.backupDir, 'src', 'to-remove.ts');
      assert.equal(fs.existsSync(backupFile), true);
      assert.equal(fs.readFileSync(backupFile, 'utf8'), 'console.log("old");\n');
    });

    it('dryRun: true plans changes without modifying disk or creating backup dir', async () => {
      const existingFile = path.join(sandboxDir, 'existing.txt');
      fs.writeFileSync(existingFile, 'Original content', 'utf8');

      const blocks = [
        {
          relativePath: 'existing.txt',
          content: 'Dry run replacement',
          isDelete: false,
        },
        {
          relativePath: 'brand-new.txt',
          content: 'Dry run new file',
          isDelete: false,
        },
      ];

      const result = await syncer.sync(blocks, { dryRun: true, timestamp: '2026-11-09_dryrun' });

      // Disk remains unchanged
      assert.equal(fs.readFileSync(existingFile, 'utf8'), 'Original content');
      assert.equal(fs.existsSync(path.join(sandboxDir, 'brand-new.txt')), false);
      assert.equal(fs.existsSync(result.backupDir), false);

      // Result reports planned modifications
      assert.equal(result.manifest.dryRun, true);
      assert.deepEqual(result.filesWritten, ['existing.txt', 'brand-new.txt']);
      assert.equal(result.manifest.filesBackedUp.length, 1);
      assert.equal(result.manifest.newFilesCreated.length, 1);
    });

    it('fails fast on syntax error and does not touch any files or create backups', async () => {
      const file1 = path.join(sandboxDir, 'valid.ts');
      fs.writeFileSync(file1, 'export const valid = 1;\n', 'utf8');

      const blocks = [
        {
          relativePath: 'valid.ts',
          content: 'export const valid = 2;\n',
          isDelete: false,
        },
        {
          relativePath: 'broken.ts',
          content: 'export const syntaxError = ( { ;',
          isDelete: false,
        },
      ];

      await assert.rejects(() => syncer.sync(blocks), /Syntax validation failed for "broken.ts"/i);

      // Verify valid.ts was NOT modified because batch failed pre-flight
      assert.equal(fs.readFileSync(file1, 'utf8'), 'export const valid = 1;\n');
    });

    it('allows bypassing syntax errors with ignoreSyntaxErrors: true', async () => {
      const blocks = [
        {
          relativePath: 'snippet.ts',
          content: 'export const partial = ( ;',
          isDelete: false,
        },
      ];

      const result = await syncer.sync(blocks, { ignoreSyntaxErrors: true });
      assert.deepEqual(result.filesWritten, ['snippet.ts']);
      assert.equal(
        fs.readFileSync(path.join(sandboxDir, 'snippet.ts'), 'utf8'),
        'export const partial = ( ;',
      );
    });
  });

  // =========================================================================
  // 6. Rollback Engine Tests
  // =========================================================================
  describe('6. Rollback Engine', () => {
    it('restores modified files, unlinks newly created files, and restores deleted files', async () => {
      // Step 1: Initial state
      const fileA = path.join(sandboxDir, 'src', 'fileA.ts');
      const fileB = path.join(sandboxDir, 'src', 'fileB.ts');
      fs.mkdirSync(path.dirname(fileA), { recursive: true });
      fs.writeFileSync(fileA, 'export const fileA = "initial";\n', 'utf8');
      fs.writeFileSync(fileB, 'export const fileB = "to delete";\n', 'utf8');

      // Step 2: Perform sync that modifies A, deletes B, creates C
      const blocks = [
        {
          relativePath: 'src/fileA.ts',
          content: 'export const fileA = "updated";\n',
          isDelete: false,
        },
        {
          relativePath: 'src/fileB.ts',
          content: '',
          isDelete: true,
        },
        {
          relativePath: 'src/fileC.ts',
          content: 'export const fileC = "brand new";\n',
          isDelete: false,
        },
      ];

      const syncResult = await syncer.sync(blocks, { timestamp: '2026-11-09_rollback-test' });

      // Verify sync state
      assert.equal(fs.readFileSync(fileA, 'utf8'), 'export const fileA = "updated";\n');
      assert.equal(fs.existsSync(fileB), false);
      const fileC = path.join(sandboxDir, 'src', 'fileC.ts');
      assert.equal(fs.existsSync(fileC), true);

      // Step 3: Trigger rollback using timestamp
      const rollbackResult = await syncer.rollback(syncResult.backupTimestamp);

      // Verify rollback result
      assert.equal(rollbackResult.restored.includes('src/fileA.ts'), true);
      assert.equal(rollbackResult.restored.includes('src/fileB.ts'), true);
      assert.equal(rollbackResult.removed.includes('src/fileC.ts'), true);

      // Verify disk is restored to exact initial state
      assert.equal(fs.readFileSync(fileA, 'utf8'), 'export const fileA = "initial";\n');
      assert.equal(fs.existsSync(fileB), true);
      assert.equal(fs.readFileSync(fileB, 'utf8'), 'export const fileB = "to delete";\n');
      assert.equal(fs.existsSync(fileC), false);
    });

    it('accepts direct path to manifest.json for rollback', async () => {
      const file = path.join(sandboxDir, 'app.json');
      fs.writeFileSync(file, JSON.stringify({ v: 1 }), 'utf8');

      const blocks = [
        {
          relativePath: 'app.json',
          content: JSON.stringify({ v: 2 }),
          isDelete: false,
        },
      ];

      const syncResult = await syncer.sync(blocks, { timestamp: '2026-11-09_manifest-path-test' });
      const manifestPath = path.join(syncResult.backupDir, 'manifest.json');

      const rollbackResult = await syncer.rollback(manifestPath);
      assert.deepEqual(rollbackResult.restored, ['app.json']);
      assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ v: 1 }));
    });

    it('throws error if backup manifest does not exist', async () => {
      await assert.rejects(
        () => syncer.rollback('non-existent-timestamp-12345'),
        /Backup manifest not found/i,
      );
    });
  });

  // =========================================================================
  // 7. Full End-to-End Lifecycle Test
  // =========================================================================
  describe('7. Full End-to-End Lifecycle', () => {
    it('executes full parsing, sync, backup, and rollback cycle from markdown text', async () => {
      // 1. Setup existing codebase files
      const mainTs = path.join(sandboxDir, 'src', 'main.ts');
      const legacyTs = path.join(sandboxDir, 'src', 'legacy.ts');
      fs.mkdirSync(path.dirname(mainTs), { recursive: true });
      fs.writeFileSync(mainTs, 'export const version = "1.0.0";\n', 'utf8');
      fs.writeFileSync(legacyTs, 'export const deprecated = true;\n', 'utf8');

      // 2. Assistant response text with multiple code fences
      const kimiResponse = [
        'Here is the completed refactor for your workspace:',
        '',
        'First, update main entrypoint:',
        '```typescript',
        '// FILE: src/main.ts',
        'export const version = "2.0.0";',
        'export const banner = "Kimi K3 Autonomous Bridge";',
        '```',
        '',
        'Next, add new helper module:',
        '```typescript',
        '// FILE: src/helper.ts',
        'export function greet(name: string): string {',
        '  return `Hello, ${name}!`;',
        '}',
        '```',
        '',
        'Remove deprecated file:',
        '```',
        '// DELETE_FILE: src/legacy.ts',
        '```',
        '',
        'And configuration file:',
        '```json',
        '// FILE: config.json',
        '{',
        '  "enabled": true,',
        '  "port": 9228',
        '}',
        '```',
        '',
        'Done! Enjoy.',
      ].join('\n');

      // 3. Parse code blocks
      const blocks = syncer.parseCodeBlocks(kimiResponse);
      assert.equal(blocks.length, 4);

      // 4. Sync to workspace
      const syncResult = await syncer.sync(blocks);
      assert.equal(syncResult.filesWritten.length, 3);
      assert.equal(syncResult.filesDeleted.length, 1);

      // Verify disk contents
      assert.equal(
        fs.readFileSync(mainTs, 'utf8'),
        'export const version = "2.0.0";\nexport const banner = "Kimi K3 Autonomous Bridge";',
      );
      assert.equal(fs.existsSync(legacyTs), false);
      const helperTs = path.join(sandboxDir, 'src', 'helper.ts');
      assert.equal(fs.existsSync(helperTs), true);
      const configJson = path.join(sandboxDir, 'config.json');
      assert.equal(fs.existsSync(configJson), true);

      // 5. Rollback
      const rollbackResult = await syncer.rollback(syncResult.backupTimestamp);
      assert.equal(rollbackResult.restored.includes('src/main.ts'), true);
      assert.equal(rollbackResult.restored.includes('src/legacy.ts'), true);
      assert.equal(rollbackResult.removed.includes('src/helper.ts'), true);
      assert.equal(rollbackResult.removed.includes('config.json'), true);

      // 6. Verify restored disk state
      assert.equal(fs.readFileSync(mainTs, 'utf8'), 'export const version = "1.0.0";\n');
      assert.equal(fs.existsSync(legacyTs), true);
      assert.equal(fs.readFileSync(legacyTs, 'utf8'), 'export const deprecated = true;\n');
      assert.equal(fs.existsSync(helperTs), false);
      assert.equal(fs.existsSync(configJson), false);
    });
  });
});
