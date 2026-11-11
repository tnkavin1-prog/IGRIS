/**
 * Unit Tests for Kimi Bridge CLI & Engine (Milestone 4)
 * E:\Gematron\tests\unit\kimi-bridge.test.mjs
 *
 * Covers:
 * - Feature 16: Master CLI & Engine argument parsing, subcommands, and pipeline execution
 * - Feature 17: Package.json scripts integration
 * - Feature 18: Desktop HUD ControlServer /kimi endpoints (/kimi/dispatch, /kimi/status)
 * - Feature 19: Desktop HUD switchboard and launcher definitions
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import * as esbuild from 'esbuild';

import {
  parseArgs,
  runPackCommand,
  runStatusCommand,
  runSendCommand,
  runSyncCommand,
  runAutonomousLoop,
  runRollbackCommand,
  PROJECT_ROOT,
  DEFAULT_MAX_CHARS,
  DEFAULT_CDP_PORT,
} from '../../scripts/kimi-bridge.mjs';

const controlServerTs = fs.readFileSync(
  path.join(PROJECT_ROOT, 'apps/desktop-hud/src/main/control-server.ts'),
  'utf8',
);
const transformedJs = esbuild.transformSync(controlServerTs, { loader: 'ts' }).code;
const { ControlServer } = await import(
  'data:text/javascript;base64,' + Buffer.from(transformedJs).toString('base64')
);

describe('Kimi Bridge Master CLI & Engine (Milestone 4)', () => {
  const tempTestDir = path.join(PROJECT_ROOT, 'temp', `test-kimi-bridge-${Date.now()}`);

  before(() => {
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // 1. CLI Argument Parsing Tests (Feature 16)
  // =========================================================================
  describe('1. CLI Argument Parsing (parseArgs)', () => {
    it('defaults to interactive mode when no arguments are passed', () => {
      const opts = parseArgs([]);
      assert.equal(opts.command, 'interactive');
      assert.equal(opts.prompt, '');
      assert.deepEqual(opts.files, []);
      assert.equal(opts.dryRun, false);
      assert.equal(opts.all, false);
      assert.equal(opts.maxChars, DEFAULT_MAX_CHARS);
      assert.equal(opts.port, DEFAULT_CDP_PORT);
    });

    it('parses "pack" subcommand with positional files and flags', () => {
      const argv = ['pack', 'file1.ts', 'file2.ts', '--max-chars', '50000', '-o', 'out.txt'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'pack');
      assert.deepEqual(opts.files, ['file1.ts', 'file2.ts']);
      assert.equal(opts.maxChars, 50000);
      assert.equal(opts.output, 'out.txt');
    });

    it('parses "--pack-only" alias as pack command', () => {
      const argv = ['--pack-only', '-f', 'src/a.ts,src/b.ts', '--prompt', 'Pack these files'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'pack');
      assert.deepEqual(opts.files, ['src/a.ts', 'src/b.ts']);
      assert.equal(opts.prompt, 'Pack these files');
    });

    it('parses "send" subcommand with prompt and target files', () => {
      const argv = ['send', 'Add unit tests', 'file1.js', 'file2.js', '--port', '9333'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'send');
      assert.equal(opts.prompt, 'Add unit tests');
      assert.deepEqual(opts.files, ['file1.js', 'file2.js']);
      assert.equal(opts.port, 9333);
    });

    it('parses "run" subcommand with prompt and flags', () => {
      const argv = [
        'run',
        'Refactor ModelSwitchboard',
        'apps/desktop-hud/src/renderer/ModelSwitchboard.tsx',
        '--dry-run',
        '--timeout',
        '60000',
        '--ignore-syntax-errors',
      ];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'run');
      assert.equal(opts.prompt, 'Refactor ModelSwitchboard');
      assert.deepEqual(opts.files, ['apps/desktop-hud/src/renderer/ModelSwitchboard.tsx']);
      assert.equal(opts.dryRun, true);
      assert.equal(opts.timeoutMs, 60000);
      assert.equal(opts.ignoreSyntaxErrors, true);
    });

    it('parses "sync" subcommand with response file', () => {
      const argv = ['sync', 'temp/response.md', '--dry-run'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'sync');
      assert.equal(opts.responseFile, 'temp/response.md');
      assert.equal(opts.dryRun, true);
    });

    it('parses "--sync-only" alias with response file', () => {
      const argv = ['--sync-only', 'temp/resp.txt'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'sync');
      assert.equal(opts.responseFile, 'temp/resp.txt');
    });

    it('parses "status" subcommand', () => {
      const argv = ['status', '--port', '9222', '--host', '127.0.0.1'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'status');
      assert.equal(opts.port, 9222);
      assert.equal(opts.host, '127.0.0.1');
    });

    it('parses "rollback" subcommand with timestamp', () => {
      const argv = ['rollback', '2026-11-09_12-00-00-000'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'rollback');
      assert.equal(opts.timestamp, '2026-11-09_12-00-00-000');
    });

    it('parses "--rollback" alias with manifest path', () => {
      const argv = ['--rollback', 'backups/kimi-history/2026-11-09/manifest.json'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'rollback');
      assert.equal(opts.timestamp, 'backups/kimi-history/2026-11-09/manifest.json');
    });

    it('parses comma-separated and repeated --files flags', () => {
      const argv = ['--files', 'a.ts,b.ts', '-f', 'c.ts', '--files=d.ts,e.ts'];
      const opts = parseArgs(argv);
      assert.deepEqual(opts.files, ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    });

    it('parses --prompt flag variants and infers run command', () => {
      const argv = ['--prompt=Fix the bug in layout', '--dry-run'];
      const opts = parseArgs(argv);
      assert.equal(opts.command, 'run');
      assert.equal(opts.prompt, 'Fix the bug in layout');
      assert.equal(opts.dryRun, true);
    });

    it('parses help flags', () => {
      assert.equal(parseArgs(['-h']).help, true);
      assert.equal(parseArgs(['--help']).help, true);
      assert.equal(parseArgs(['help']).command, 'help');
    });
  });

  // =========================================================================
  // 2. Pack Command Execution Tests (Feature 16)
  // =========================================================================
  describe('2. Pack Command Execution (runPackCommand)', () => {
    it('gathers files and writes prompt output to file when specified', async () => {
      const testOutFile = path.join(tempTestDir, 'packed-output.txt');
      const mockPacker = async (opts) => {
        assert.equal(opts.maxChars, 12000);
        assert.equal(opts.userPrompt, 'Test packing');
        return {
          prompt: '# PROMPT\n```ts\n// FILE: test.ts\nconst x = 1;\n```',
          fileCount: 1,
          totalChars: 50,
          tree: 'tree',
          filesIncluded: ['test.ts'],
        };
      };

      const res = await runPackCommand(
        {
          projectRoot: tempTestDir,
          prompt: 'Test packing',
          maxChars: 12000,
          output: testOutFile,
        },
        mockPacker,
      );

      assert.equal(res.fileCount, 1);
      assert.equal(res.outputPath, testOutFile);
      assert.ok(fs.existsSync(testOutFile));
      assert.equal(fs.readFileSync(testOutFile, 'utf8'), res.prompt);
    });
  });

  // =========================================================================
  // 3. Status Command Execution Tests (Feature 16)
  // =========================================================================
  describe('3. Status Command Execution (runStatusCommand)', () => {
    it('detects active Arena tab via mock driver', async () => {
      const mockDriver = {
        findArenaTab: async () => ({
          id: 'tab-123',
          title: 'LMSYS Chatbot Arena',
          url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-123',
        }),
      };

      const res = await runStatusCommand({}, mockDriver);
      assert.equal(res.ok, true);
      assert.equal(res.cdpConnected, true);
      assert.equal(res.arenaTabOpen, true);
      assert.equal(res.tab.id, 'tab-123');
    });

    it('handles unreachable CDP gracefully without throwing', async () => {
      const mockDriver = {
        findArenaTab: async () => {
          throw new Error('Connection refused');
        },
      };

      const res = await runStatusCommand({ port: 65534 }, mockDriver);
      assert.equal(res.ok, true);
      assert.equal(res.cdpConnected, false);
      assert.equal(res.arenaTabOpen, false);
      assert.equal(res.tab, null);
    });
  });

  // =========================================================================
  // 4. Send Command Execution Tests (Feature 16)
  // =========================================================================
  describe('4. Send Command Execution (runSendCommand)', () => {
    it('packs context, connects, injects, and submits prompt', async () => {
      let injected = null;
      let submitted = false;

      const mockDriver = {
        activeTab: { id: 'tab-1', title: 'Arena', url: 'https://arena.ai' },
        connect: async () => true,
        injectPrompt: async (prompt) => {
          injected = prompt;
          return { success: true };
        },
        submitPrompt: async () => {
          submitted = true;
          return { success: true };
        },
        disconnect: async () => {},
      };

      const mockPacker = async () => ({
        prompt: 'PACKED_PROMPT_CONTENT',
        fileCount: 2,
        totalChars: 21,
        filesIncluded: ['a.ts', 'b.ts'],
      });

      const res = await runSendCommand(
        { prompt: 'Generate unit tests' },
        { driver: mockDriver, packContext: mockPacker },
      );

      assert.equal(res.success, true);
      assert.equal(injected, 'PACKED_PROMPT_CONTENT');
      assert.equal(submitted, true);
      assert.equal(res.promptLength, 21);
      assert.equal(res.fileCount, 2);
    });

    it('throws error when CDP connection fails', async () => {
      const mockDriver = {
        connect: async () => false,
      };

      await assert.rejects(
        runSendCommand({ prompt: 'Hello' }, { driver: mockDriver }),
        /Failed to connect to LMSYS Arena tab/,
      );
    });

    it('throws error when injection fails', async () => {
      const mockDriver = {
        connect: async () => true,
        injectPrompt: async () => ({ success: false }),
        disconnect: async () => {},
      };
      const mockPacker = async () => ({ prompt: 'P', fileCount: 0, totalChars: 1 });

      await assert.rejects(
        runSendCommand({ prompt: 'Hello' }, { driver: mockDriver, packContext: mockPacker }),
        /Failed to inject prompt into Arena chatbox textarea/,
      );
    });
  });

  // =========================================================================
  // 5. Sync Command Execution Tests (Feature 16)
  // =========================================================================
  describe('5. Sync Command Execution (runSyncCommand)', () => {
    it('parses and syncs code blocks from responseFile', async () => {
      const respFile = path.join(tempTestDir, 'response.md');
      const markdownContent = `
Here is the code:
\`\`\`typescript
// FILE: apps/desktop-hud/src/renderer/TestWidget.tsx
export const TestWidget = () => <div>Hello</div>;
\`\`\`
`;
      fs.writeFileSync(respFile, markdownContent, 'utf8');

      let parsedBlocks = null;
      let syncOptions = null;

      const mockSyncer = {
        parseCodeBlocks: (text) => {
          assert.equal(text, markdownContent);
          parsedBlocks = [
            { relativePath: 'apps/desktop-hud/src/renderer/TestWidget.tsx', content: 'widget' },
          ];
          return parsedBlocks;
        },
        sync: async (blocks, opts) => {
          syncOptions = opts;
          return {
            backupTimestamp: '2026-11-09_13-00-00-000',
            backupDir: 'E:/Gematron/backups/kimi-history/2026-11-09_13-00-00-000',
            filesWritten: ['apps/desktop-hud/src/renderer/TestWidget.tsx'],
            filesDeleted: [],
            manifest: { timestamp: '2026-11-09_13-00-00-000' },
          };
        },
      };

      const res = await runSyncCommand(
        { responseFile: respFile, dryRun: true },
        { syncer: mockSyncer },
      );

      assert.equal(res.ok, true);
      assert.equal(res.blocksFound, 1);
      assert.deepEqual(res.filesWritten, ['apps/desktop-hud/src/renderer/TestWidget.tsx']);
      assert.equal(res.dryRun, true);
      assert.equal(syncOptions.dryRun, true);
    });

    it('returns clean message when response contains no code blocks', async () => {
      const mockSyncer = {
        parseCodeBlocks: () => [],
      };

      const res = await runSyncCommand(
        { responseText: 'Just conversational explanation without code.' },
        { syncer: mockSyncer },
      );

      assert.equal(res.ok, true);
      assert.equal(res.blocksFound, 0);
      assert.deepEqual(res.filesWritten, []);
    });

    it('throws error when responseFile does not exist', async () => {
      await assert.rejects(
        runSyncCommand({ responseFile: 'non-existent-file.md' }),
        /Response file not found/,
      );
    });
  });

  // =========================================================================
  // 6. Autonomous Loop Execution Tests (Feature 16)
  // =========================================================================
  describe('6. Autonomous Loop Execution (runAutonomousLoop)', () => {
    it('executes the full cycle: pack -> inject -> submit -> wait -> sync', async () => {
      const mockPacker = async (opts) => {
        assert.equal(opts.userPrompt, 'Implement feature');
        return { prompt: 'PACKED_PROMPT', fileCount: 1, totalChars: 13, filesIncluded: ['a.ts'] };
      };

      let injectCalled = false;
      let submitCalled = false;
      let waitCalled = false;

      const mockDriver = {
        activeTab: { id: 'tab-9', title: 'Arena Kimi K3', url: 'https://arena.ai' },
        connect: async () => true,
        injectPrompt: async (p) => {
          injectCalled = true;
          return { success: true };
        },
        submitPrompt: async () => {
          submitCalled = true;
          return { success: true };
        },
        waitForCompletion: async () => {
          waitCalled = true;
          return {
            text: '```typescript\n// FILE: src/updated.ts\nexport const x = 42;\n```',
            durationMs: 350,
          };
        },
        disconnect: async () => {},
      };

      const mockSyncer = {
        parseCodeBlocks: (text) => [
          { relativePath: 'src/updated.ts', content: 'export const x = 42;' },
        ],
        sync: async (blocks, opts) => ({
          backupTimestamp: '2026-11-09_13-05-00-000',
          backupDir: 'E:/Gematron/backups/kimi-history/2026-11-09_13-05-00-000',
          filesWritten: ['src/updated.ts'],
          filesDeleted: [],
          manifest: { timestamp: '2026-11-09_13-05-00-000' },
        }),
      };

      const res = await runAutonomousLoop(
        { prompt: 'Implement feature', dryRun: false },
        { packContext: mockPacker, driver: mockDriver, syncer: mockSyncer },
      );

      assert.equal(res.ok, true);
      assert.equal(injectCalled, true);
      assert.equal(submitCalled, true);
      assert.equal(waitCalled, true);
      assert.deepEqual(res.filesModified, ['src/updated.ts']);
      assert.equal(res.blocksCount, 1);
      assert.equal(res.dryRun, false);
      assert.ok(res.durationMs >= 0);
    });

    it('handles execution errors and disconnects driver', async () => {
      let disconnected = false;
      const mockDriver = {
        connect: async () => true,
        injectPrompt: async () => {
          throw new Error('DOM interaction failed');
        },
        disconnect: async () => {
          disconnected = true;
        },
      };

      await assert.rejects(
        runAutonomousLoop(
          { prompt: 'Fail test' },
          { driver: mockDriver, packContext: async () => ({ prompt: '' }) },
        ),
        /DOM interaction failed/,
      );
    });
  });

  // =========================================================================
  // 7. Rollback Command Tests (Feature 16)
  // =========================================================================
  describe('7. Rollback Command Execution (runRollbackCommand)', () => {
    it('restores files from backup manifest via syncer', async () => {
      const mockSyncer = {
        rollback: async (ts) => {
          assert.equal(ts, '2026-11-09_13-00-00-000');
          return {
            restored: ['apps/desktop-hud/src/renderer/ModelSwitchboard.tsx'],
            removed: [],
          };
        },
      };

      const res = await runRollbackCommand('2026-11-09_13-00-00-000', mockSyncer);
      assert.equal(res.ok, true);
      assert.deepEqual(res.restored, ['apps/desktop-hud/src/renderer/ModelSwitchboard.tsx']);
    });

    it('rejects empty timestamp argument', async () => {
      await assert.rejects(runRollbackCommand(''), /A valid backup timestamp/);
    });
  });

  // =========================================================================
  // 8. Package.json Script Verification (Feature 17)
  // =========================================================================
  describe('8. Package.json Script Verification (Feature 17)', () => {
    it('registers "kimi:bridge" and "kimi:chrome" in package.json', () => {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

      assert.equal(typeof pkg.scripts['kimi:bridge'], 'string');
      assert.equal(pkg.scripts['kimi:bridge'], 'node scripts/kimi-bridge.mjs');

      assert.equal(typeof pkg.scripts['kimi:chrome'], 'string');
      assert.ok(pkg.scripts['kimi:chrome'].includes('launch-arena-chrome.ps1'));
    });
  });

  // =========================================================================
  // 9. Desktop HUD ControlServer /kimi Endpoints (Feature 18)
  // =========================================================================
  describe('9. Desktop HUD ControlServer /kimi Endpoints (Feature 18)', () => {
    let server;
    const TEST_PORT = 9245;

    afterEach(() => {
      if (server) {
        server.stop();
        server = null;
      }
    });

    it('responds to GET /kimi/status with CDP and tab status', async () => {
      server = new ControlServer(TEST_PORT, '127.0.0.1', {
        onKimiStatus: async () => ({
          ok: true,
          cdpConnected: true,
          arenaTabOpen: true,
          tab: {
            id: 'mock-tab-1',
            title: 'LMSYS Chatbot Arena - Kimi K3',
            url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
          },
        }),
      });

      await server.start(() => null, {});

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/kimi/status`);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.cdpConnected, true);
      assert.equal(data.arenaTabOpen, true);
      assert.equal(data.tab.id, 'mock-tab-1');
    });

    it('handles POST /kimi/dispatch with autonomous pipeline result', async () => {
      server = new ControlServer(TEST_PORT, '127.0.0.1', {
        onKimiDispatch: async (payload) => {
          assert.equal(payload.prompt, 'Refactor switchboard');
          assert.equal(payload.dryRun, true);
          return {
            ok: true,
            durationMs: 840,
            filesModified: ['apps/desktop-hud/src/renderer/ModelSwitchboard.tsx'],
            backupPath: 'E:/Gematron/backups/kimi-history/2026-11-09_13-00-00-000',
            manifest: { timestamp: '2026-11-09_13-00-00-000' },
            dryRun: true,
          };
        },
      });

      await server.start(() => null, {});

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/kimi/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Refactor switchboard',
          dryRun: true,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.durationMs, 840);
      assert.deepEqual(data.filesModified, ['apps/desktop-hud/src/renderer/ModelSwitchboard.tsx']);
      assert.equal(data.dryRun, true);
    });

    it('rejects POST /kimi/dispatch without prompt with HTTP 400', async () => {
      server = new ControlServer(TEST_PORT, '127.0.0.1');
      await server.start(() => null, {});

      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/kimi/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '' }),
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('prompt string is required'));
    });
  });

  // =========================================================================
  // 10. Desktop HUD UI Integration Verification (Feature 19)
  // =========================================================================
  describe('10. Desktop HUD UI Integration (Feature 19)', () => {
    it('verifies Kimi K3 card is integrated into ModelSwitchboard.tsx', () => {
      const switchboardPath = path.join(
        PROJECT_ROOT,
        'apps/desktop-hud/src/renderer/ModelSwitchboard.tsx',
      );
      const content = fs.readFileSync(switchboardPath, 'utf8');

      assert.ok(content.includes("key: 'kimi'"), 'Should contain key: kimi');
      assert.ok(content.includes('Kimi K3'), 'Should contain Kimi K3 name');
      assert.ok(content.includes('Arena bridge'), 'Should contain Arena bridge provider');
      assert.ok(content.includes('Zero-cost session'), 'Should contain zero cost status');
      assert.ok(content.includes('setDispatchModel'), 'Should contain dispatch selector');
    });

    it('verifies Kimi K3 skill card is integrated into SkillLauncherPanel.tsx', () => {
      const panelPath = path.join(
        PROJECT_ROOT,
        'apps/desktop-hud/src/renderer/SkillLauncherPanel.tsx',
      );
      const content = fs.readFileSync(panelPath, 'utf8');

      assert.ok(content.includes("id: 'kimi'"), 'Should contain id: kimi');
      assert.ok(content.includes('Kimi K3 Arena Bridge'), 'Should contain Kimi skill name');
      assert.ok(content.includes('Autonomous context packing'), 'Should contain skill description');
    });
  });
});
