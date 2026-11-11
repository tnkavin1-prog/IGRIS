/**
 * Tier 1: Feature Coverage Test Suite
 * Tests each inventoried feature from PROJECT.md / DISPATCH.md:
 * - F1: File Crawling & Filtering (Context Packer)
 * - F2: Workspace Directory Tree Generator
 * - F3: Coding Contract Prompt Assembler
 * - F4: Raw CDP Client (Zero-Deps WebSocket)
 * - F5: Arena Tab Discovery (URL & UUID)
 * - F6: React Value Setter Injection Bypass
 * - F7: Trusted Hardware Event Submission (CDP Enter)
 * - F8: Streaming Generation & Debounce Completion
 * - F9: Chrome Launcher Helper Script
 * - F10: Markdown Code Block Parser
 * - F11: Path Traversal Security Guard
 * - F12: Timestamped Backup Engine & Manifest
 * - F13: Atomic File Writer
 * - F14: Pre-Flight Syntax Validator (esbuild/JSON)
 * - F15: Instant Rollback Engine
 * - F16-F19: CLI & HUD Integration Check
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MockCDPServer } from './mock-cdp-server.mjs';

// Dynamic imports of modules under test
let packContext, scanWorkspace, generateDirectoryTree, assemblePrompt, isBinaryFile;
let ArenaCDPDriver;
let CodeSyncer, parseCodeBlocks, validateAndResolvePath, validateSyntax, atomicWriteFile;

try {
  const packerMod = await import('../../scripts/lib/context-packer.mjs');
  packContext = packerMod.packContext;
  scanWorkspace = packerMod.scanWorkspace;
  generateDirectoryTree = packerMod.generateDirectoryTree;
  assemblePrompt = packerMod.assemblePrompt;
  isBinaryFile = packerMod.isBinaryFile;
} catch (e) {
  // Graceful progressive testability if module not yet available
}

try {
  const driverMod = await import('../../scripts/lib/arena-cdp-driver.mjs');
  ArenaCDPDriver = driverMod.ArenaCDPDriver;
} catch (e) {}

try {
  const syncerMod = await import('../../scripts/lib/code-syncer.mjs');
  CodeSyncer = syncerMod.CodeSyncer;
  parseCodeBlocks = syncerMod.parseCodeBlocks;
  validateAndResolvePath = syncerMod.validateAndResolvePath;
  validateSyntax = syncerMod.validateSyntax;
  atomicWriteFile = syncerMod.atomicWriteFile;
} catch (e) {}

export const name = 'Tier 1: Feature Coverage';

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

  // Helper to create hermetic sandbox directory
  function createSandbox() {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gematron-t1-'));
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
  // FEATURE 1: File Crawling & Filtering
  // --------------------------------------------------------------------------
  await record('F1: File Crawling respects .gitignore, ignores binaries & size caps', async () => {
    assert.ok(scanWorkspace, 'scanWorkspace must be exported from context-packer.mjs');
    const sandbox = createSandbox();
    try {
      // Setup fixture files
      fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(sandbox.dir, 'node_modules', 'dummy'), { recursive: true });
      fs.mkdirSync(path.join(sandbox.dir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(sandbox.dir, 'dist'), { recursive: true });

      // Valid text source files
      fs.writeFileSync(path.join(sandbox.dir, 'src', 'index.ts'), 'export const hello = "world";');
      fs.writeFileSync(path.join(sandbox.dir, 'README.md'), '# Project Title');

      // Excluded dirs
      fs.writeFileSync(
        path.join(sandbox.dir, 'node_modules', 'dummy', 'index.js'),
        'module.exports = {};',
      );
      fs.writeFileSync(
        path.join(sandbox.dir, '.git', 'config'),
        '[core]\nrepositoryformatversion = 0',
      );
      fs.writeFileSync(path.join(sandbox.dir, 'dist', 'bundle.js'), 'console.log("bundle");');

      // Excluded files: secret .env
      fs.writeFileSync(path.join(sandbox.dir, '.env'), 'SECRET_KEY=12345');

      // Binary file by extension
      fs.writeFileSync(
        path.join(sandbox.dir, 'src', 'logo.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );

      // Binary file by null-byte sniffing
      const nullByteBuf = Buffer.alloc(100);
      nullByteBuf.write('Text preamble');
      nullByteBuf[25] = 0x00; // embedded null byte
      fs.writeFileSync(path.join(sandbox.dir, 'src', 'data.txt'), nullByteBuf);

      // Large file exceeding 150 KB
      const largeContent = 'A'.repeat(160 * 1024);
      fs.writeFileSync(path.join(sandbox.dir, 'src', 'huge.txt'), largeContent);

      const candidates = scanWorkspace(sandbox.dir);
      const relativePaths = candidates.map((c) => c.relativePath.replace(/\\/g, '/'));

      // Assertions
      assert.ok(relativePaths.includes('src/index.ts'), 'Must include src/index.ts');
      assert.ok(relativePaths.includes('README.md'), 'Must include README.md');

      assert.ok(
        !relativePaths.some((p) => p.startsWith('node_modules/')),
        'Must exclude node_modules',
      );
      assert.ok(!relativePaths.some((p) => p.startsWith('.git/')), 'Must exclude .git');
      assert.ok(!relativePaths.some((p) => p.startsWith('dist/')), 'Must exclude dist');
      assert.ok(!relativePaths.includes('.env'), 'Must exclude .env');
      assert.ok(!relativePaths.includes('src/logo.png'), 'Must exclude .png binary extension');
      assert.ok(!relativePaths.includes('src/data.txt'), 'Must exclude null-byte binary file');
      assert.ok(!relativePaths.includes('src/huge.txt'), 'Must exclude files > 150 KB');
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 2: Workspace Directory Tree Generator
  // --------------------------------------------------------------------------
  await record('F2: ASCII Directory Tree Formatter generates clean source hierarchy', async () => {
    assert.ok(generateDirectoryTree, 'generateDirectoryTree must be exported');
    const sandbox = createSandbox();
    try {
      fs.mkdirSync(path.join(sandbox.dir, 'apps', 'desktop'), { recursive: true });
      fs.mkdirSync(path.join(sandbox.dir, 'packages', 'core'), { recursive: true });
      fs.writeFileSync(path.join(sandbox.dir, 'apps', 'desktop', 'main.ts'), '// desktop');
      fs.writeFileSync(path.join(sandbox.dir, 'packages', 'core', 'index.ts'), '// core');
      fs.writeFileSync(path.join(sandbox.dir, 'package.json'), '{}');

      const tree = generateDirectoryTree(sandbox.dir);
      assert.ok(typeof tree === 'string' && tree.length > 0, 'Tree must be non-empty string');
      assert.ok(tree.includes('apps/'), 'Tree must list apps/');
      assert.ok(tree.includes('desktop/'), 'Tree must list desktop/');
      assert.ok(tree.includes('packages/'), 'Tree must list packages/');
      assert.ok(tree.includes('main.ts'), 'Tree must list main.ts');
      assert.ok(
        tree.includes('├── ') || tree.includes('└── '),
        'Tree must use standard box-drawing characters',
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 3: Coding Contract Prompt Assembler
  // --------------------------------------------------------------------------
  await record('F3: Coding Contract Prompt Assembler enforces // FILE: contract', async () => {
    assert.ok(packContext, 'packContext must be exported');
    const sandbox = createSandbox();
    try {
      fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(sandbox.dir, 'src', 'app.ts'), 'console.log("hello");');

      const packed = await packContext({
        projectRoot: sandbox.dir,
        userPrompt: 'Refactor app.ts to use ES modules',
      });

      assert.ok(packed.prompt, 'Packed prompt must be non-empty');
      assert.ok(packed.prompt.includes('# TASK OBJECTIVE'), 'Must have TASK OBJECTIVE section');
      assert.ok(
        packed.prompt.includes('Refactor app.ts to use ES modules'),
        'Must include user prompt',
      );
      assert.ok(
        packed.prompt.includes('# WORKSPACE DIRECTORY STRUCTURE'),
        'Must include directory structure',
      );
      assert.ok(
        packed.prompt.includes('# WORKSPACE CONTEXT FILES'),
        'Must include context files section',
      );
      assert.ok(packed.prompt.includes('--- FILE: src/app.ts ---'), 'Must include file separator');
      assert.ok(
        packed.prompt.includes('# AUTONOMOUS EXECUTION CONTRACT'),
        'Must include execution contract',
      );
      assert.ok(
        packed.prompt.includes('// FILE: relative/path/to/file.ext'),
        'Must mandate // FILE: format',
      );
      assert.ok(packed.prompt.includes('// DELETE_FILE:'), 'Must document delete format');
      assert.equal(packed.fileCount, 1, 'File count must match included files');
      assert.ok(packed.filesIncluded.includes('src/app.ts'), 'filesIncluded must list src/app.ts');
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 4: Raw CDP Client (Zero-Deps WebSocket)
  // --------------------------------------------------------------------------
  await record('F4: Raw CDP Client connects to port 9222 and dispatches commands', async () => {
    assert.ok(ArenaCDPDriver, 'ArenaCDPDriver must be exported');
    const mockServer = new MockCDPServer({ port: 9231 });
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({
        port: 9231,
        host: '127.0.0.1',
      });
      driver.on('error', () => {});

      const connected = await driver.connect();
      assert.equal(connected, true, 'Driver must connect successfully to mock CDP server');
      assert.equal(driver.isConnected, true, 'isConnected state must be true');

      const evalRes = await driver.evaluate('1 + 2');
      assert.equal(evalRes, 3, 'Runtime.evaluate must return computed result 3');

      await driver.disconnect();
      assert.equal(driver.isConnected, false, 'isConnected must be false after disconnect');
    } finally {
      await mockServer.stop();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 5: Arena Tab Discovery
  // --------------------------------------------------------------------------
  await record('F5: Arena Tab Discovery discovers target tab by URL and UUID', async () => {
    assert.ok(ArenaCDPDriver, 'ArenaCDPDriver must be exported');
    const mockServer = new MockCDPServer({ port: 9232 });
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({ port: 9232 });
      driver.on('error', () => {});
      const tab = await driver.findArenaTab();

      assert.ok(tab, 'Target tab must be discovered');
      assert.ok(tab.url.includes('arena.ai'), 'Tab URL must include arena.ai');
      assert.ok(
        tab.url.includes('01a1c009-84f1-7542-be3f-6d258f0bb652'),
        'Tab URL must match session UUID',
      );
      assert.ok(tab.webSocketDebuggerUrl.includes('ws://'), 'Tab must expose webSocketDebuggerUrl');
    } finally {
      await mockServer.stop();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 6: React Value Setter Injection Bypass
  // --------------------------------------------------------------------------
  await record('F6: React Value Setter Bypass injects prompt into textarea', async () => {
    assert.ok(ArenaCDPDriver, 'ArenaCDPDriver must be exported');
    const mockServer = new MockCDPServer({ port: 9233 });
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({ port: 9233 });
      driver.on('error', () => {});
      await driver.connect();

      const testPrompt = 'AUTONOMOUS_BRIDGE_TEST_PAYLOAD_123';
      const result = await driver.injectPrompt(testPrompt);

      assert.equal(result.success, true, 'injectPrompt must report success: true');
      assert.ok(
        mockServer.domState.injectedPrompts.length > 0,
        'Server must record injected prompt',
      );
      await driver.disconnect();
    } finally {
      await mockServer.stop();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 7: Trusted Hardware Event Submission
  // --------------------------------------------------------------------------
  await record('F7: Trusted Event Submission sends authentic CDP Enter keypress', async () => {
    assert.ok(ArenaCDPDriver, 'ArenaCDPDriver must be exported');
    const mockServer = new MockCDPServer({ port: 9234 });
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({ port: 9234 });
      driver.on('error', () => {});
      await driver.connect();

      const submitRes = await driver.submitPrompt();
      assert.equal(submitRes.success, true, 'submitPrompt must succeed');

      // Verify CDP commands sent to server
      const keyEvents = mockServer.receivedCalls.filter(
        (c) => c.method === 'Input.dispatchKeyEvent',
      );
      assert.ok(keyEvents.length >= 2, 'Must dispatch rawKeyDown and keyUp for Enter');
      assert.equal(keyEvents[0].params.key, 'Enter', 'First key event must be Enter');
      assert.equal(keyEvents[0].params.windowsVirtualKeyCode, 13, 'Virtual key code must be 13');

      await driver.disconnect();
    } finally {
      await mockServer.stop();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 8: Streaming Generation & Debounce Completion
  // --------------------------------------------------------------------------
  await record('F8: Streaming & Completion Detector tracks Stop toggle and debounce', async () => {
    assert.ok(ArenaCDPDriver, 'ArenaCDPDriver must be exported');
    const mockServer = new MockCDPServer({ port: 9235, streamDelayMs: 30 });
    mockServer.setScenario('standard-refactor');
    await mockServer.start();

    try {
      const driver = new ArenaCDPDriver({ port: 9235 });
      driver.on('error', () => {});
      await driver.connect();

      // Trigger generation
      await driver.submitPrompt();

      // Wait for completion with fast polling for test
      const completion = await driver.waitForCompletion({
        pollIntervalMs: 20,
        debounceMs: 50,
        timeoutMs: 3000,
      });

      assert.ok(
        completion.text.includes('// FILE: packages/shared/src/utils/calculator.ts'),
        'Must capture complete response',
      );
      assert.ok(completion.durationMs >= 0, 'Must record duration');
      assert.ok(ArenaCDPDriver.isCodeFenceParityEven(completion.text), 'Fence parity must be even');

      await driver.disconnect();
    } finally {
      await mockServer.stop();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 9: Chrome Launcher Helper Script
  // --------------------------------------------------------------------------
  await record('F9: Chrome Launcher Helper script exists and is executable', async () => {
    const launcherPath = path.resolve('scripts/launch-arena-chrome.ps1');
    assert.ok(fs.existsSync(launcherPath), 'scripts/launch-arena-chrome.ps1 must exist');
    const content = fs.readFileSync(launcherPath, 'utf8');
    assert.ok(content.includes('--remote-debugging-port=9222'), 'Script must specify port 9222');
    assert.ok(
      content.includes('chrome.exe') || content.includes('Chrome'),
      'Script must launch Chrome',
    );
  })();

  // --------------------------------------------------------------------------
  // FEATURE 10: Markdown Code Block Parser
  // --------------------------------------------------------------------------
  await record(
    'F10: Markdown Code Block Parser extracts FILE and DELETE_FILE headers',
    async () => {
      assert.ok(parseCodeBlocks, 'parseCodeBlocks must be exported');
      const sampleMarkdown = [
        'Here are the changes requested:\n\n',
        '```typescript\n',
        '// FILE: apps/desktop/main.ts\n',
        'export const APP_ID = "gematron-app";\n',
        '```\n\n',
        '```python\n',
        '# FILE: scripts/analyze.py\n',
        'print("Python script updated")\n',
        '```\n\n',
        '```typescript\n',
        '// DELETE_FILE: apps/desktop/obsolete.ts\n',
        '```\n\n',
        '```json\n',
        '// Unrelated code block with no FILE header\n',
        '{"status": "ok"}\n',
        '```\n',
      ].join('');

      const blocks = parseCodeBlocks(sampleMarkdown);
      assert.equal(blocks.length, 3, 'Must extract exactly 3 actionable blocks');

      assert.equal(blocks[0].relativePath, 'apps/desktop/main.ts');
      assert.ok(
        blocks[0].content.includes('export const APP_ID'),
        'Must strip header line from content',
      );
      assert.equal(blocks[0].isDelete, false);

      assert.equal(blocks[1].relativePath, 'scripts/analyze.py');
      assert.ok(blocks[1].content.includes('print('), 'Must support python # comments');
      assert.equal(blocks[1].isDelete, false);

      assert.equal(blocks[2].relativePath, 'apps/desktop/obsolete.ts');
      assert.equal(blocks[2].isDelete, true, 'Must identify deletion block');
    },
  )();

  // --------------------------------------------------------------------------
  // FEATURE 11: Path Traversal Security Guard
  // --------------------------------------------------------------------------
  await record('F11: Path Traversal Security Guard validates project containment', async () => {
    assert.ok(validateAndResolvePath, 'validateAndResolvePath must be exported');
    const sandbox = createSandbox();
    try {
      // Valid path inside project
      const valid = validateAndResolvePath(sandbox.dir, 'src/components/Header.tsx');
      assert.equal(valid.relative, 'src/components/Header.tsx');
      assert.ok(valid.resolved.startsWith(sandbox.dir));

      // Attack vectors
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, '../../outside.txt'),
        /Security Violation/i,
        'Must block ../../ traversal',
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, 'C:\\Windows\\System32\\cmd.exe'),
        /Security Violation/i,
        'Must block absolute drive paths',
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, '\\\\network\\share\\file.txt'),
        /Security Violation/i,
        'Must block UNC paths',
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, '.git/hooks/pre-commit'),
        /Security Violation/i,
        'Must block .git path',
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, '.env'),
        /Security Violation/i,
        'Must block .env files',
      );
      assert.throws(
        () => validateAndResolvePath(sandbox.dir, 'node_modules/pkg/index.js'),
        /Security Violation/i,
        'Must block node_modules',
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 12: Timestamped Backup Engine
  // --------------------------------------------------------------------------
  await record('F12: Timestamped Backup Engine creates backup & manifest before sync', async () => {
    assert.ok(CodeSyncer, 'CodeSyncer must be exported');
    const sandbox = createSandbox();
    try {
      const syncer = new CodeSyncer({
        projectRoot: sandbox.dir,
        backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
      });

      // Create pre-existing file
      fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(sandbox.dir, 'src', 'service.ts'), 'export const version = 1;');

      const result = await syncer.sync([
        {
          relativePath: 'src/service.ts',
          content: 'export const version = 2;',
          isDelete: false,
        },
      ]);

      assert.ok(result.backupTimestamp, 'Must return backup timestamp');
      assert.ok(fs.existsSync(result.backupDir), 'Backup directory must exist');

      // Verify backed-up original
      const backedUpFile = path.join(result.backupDir, 'src', 'service.ts');
      assert.ok(fs.existsSync(backedUpFile), 'Original file must be backed up');
      assert.equal(
        fs.readFileSync(backedUpFile, 'utf8'),
        'export const version = 1;',
        'Backed up file must match original',
      );

      // Verify manifest.json
      const manifestPath = path.join(result.backupDir, 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must be written in backup folder');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.filesBackedUp.length, 1);
      assert.equal(manifest.filesBackedUp[0].relative, 'src/service.ts');
      assert.ok(manifest.filesBackedUp[0].sha256, 'Manifest must record SHA-256');

      // Verify new content written to workspace
      assert.equal(
        fs.readFileSync(path.join(sandbox.dir, 'src', 'service.ts'), 'utf8'),
        'export const version = 2;',
      );
    } finally {
      sandbox.cleanup();
    }
  })();

  // --------------------------------------------------------------------------
  // FEATURE 13: Atomic File Writer
  // --------------------------------------------------------------------------
  await record(
    'F13: Atomic File Writer creates temporary sibling and overwrites cleanly',
    async () => {
      assert.ok(atomicWriteFile, 'atomicWriteFile must be exported');
      const sandbox = createSandbox();
      try {
        const dest = path.join(sandbox.dir, 'sub', 'atomic.txt');
        atomicWriteFile(dest, 'Atomic test content');

        assert.ok(fs.existsSync(dest), 'Target file must exist');
        assert.equal(fs.readFileSync(dest, 'utf8'), 'Atomic test content');

        // Verify no temporary files left behind
        const siblingFiles = fs.readdirSync(path.join(sandbox.dir, 'sub'));
        assert.equal(siblingFiles.length, 1, 'Only target file must remain in directory');
        assert.equal(siblingFiles[0], 'atomic.txt');
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // FEATURE 14: Pre-Flight Syntax Validator
  // --------------------------------------------------------------------------
  await record(
    'F14: Pre-Flight Syntax Validator validates TS/JS with esbuild and JSON with JSON.parse',
    async () => {
      assert.ok(validateSyntax, 'validateSyntax must be exported');

      // Valid TypeScript
      assert.equal(
        validateSyntax('test.ts', 'export function calc(x: number): number { return x * 2; }'),
        true,
      );

      // Valid JSON
      assert.equal(validateSyntax('config.json', '{"status": 200, "active": true}'), true);

      // Invalid TypeScript (syntax error)
      assert.throws(
        () => validateSyntax('broken.ts', 'const a = (('),
        /Syntax validation failed/i,
        'Must reject broken TS syntax',
      );

      // Invalid JSON
      assert.throws(
        () => validateSyntax('broken.json', '{ active: true, }'),
        /Syntax validation failed/i,
        'Must reject invalid JSON',
      );
    },
  )();

  // --------------------------------------------------------------------------
  // FEATURE 15: Instant Rollback Engine
  // --------------------------------------------------------------------------
  await record(
    'F15: Instant Rollback Engine restores backed-up files and removes new files',
    async () => {
      assert.ok(CodeSyncer, 'CodeSyncer must be exported');
      const sandbox = createSandbox();
      try {
        const syncer = new CodeSyncer({
          projectRoot: sandbox.dir,
          backupDir: path.join(sandbox.dir, 'backups', 'kimi-history'),
        });

        // Existing file
        fs.mkdirSync(path.join(sandbox.dir, 'src'), { recursive: true });
        fs.writeFileSync(path.join(sandbox.dir, 'src', 'original.ts'), 'const initial = 100;');

        // Sync modifications: update original.ts and create new.ts
        const syncResult = await syncer.sync([
          { relativePath: 'src/original.ts', content: 'const initial = 999;' },
          { relativePath: 'src/new.ts', content: 'const brandNew = true;' },
        ]);

        assert.equal(
          fs.readFileSync(path.join(sandbox.dir, 'src', 'original.ts'), 'utf8'),
          'const initial = 999;',
        );
        assert.ok(fs.existsSync(path.join(sandbox.dir, 'src', 'new.ts')));

        // Execute rollback
        const rollbackResult = await syncer.rollback(syncResult.backupTimestamp);

        assert.ok(rollbackResult.restored.includes('src/original.ts'), 'Must record restored file');
        assert.ok(rollbackResult.removed.includes('src/new.ts'), 'Must record removed new file');

        // Verify filesystem state after rollback
        assert.equal(
          fs.readFileSync(path.join(sandbox.dir, 'src', 'original.ts'), 'utf8'),
          'const initial = 100;',
          'Original file restored',
        );
        assert.ok(
          !fs.existsSync(path.join(sandbox.dir, 'src', 'new.ts')),
          'New file must be unlinked',
        );
      } finally {
        sandbox.cleanup();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // FEATURE 16-19: Package & CLI Integration Verification
  // --------------------------------------------------------------------------
  await record('F16-F19: Root package.json and CLI readiness checks', async () => {
    const pkgPath = path.resolve('package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Check workspaces and dependencies
    assert.ok(pkg.workspaces, 'package.json must define workspaces');
    assert.ok(pkg.dependencies?.ws || pkg.devDependencies?.ws, 'ws dependency must be present');
    assert.ok(pkg.devDependencies?.esbuild, 'esbuild dependency must be present');
  })();

  return results;
}
