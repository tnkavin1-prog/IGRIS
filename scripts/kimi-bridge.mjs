#!/usr/bin/env node
/**
 * Master CLI & Engine for Autonomous Kimi K3 Arena Bridge
 * E:\Gematron\scripts\kimi-bridge.mjs
 *
 * Implements Milestone 4 (Feature 16):
 * - Integrates Context Packer, Arena CDP Driver, and Code Syncer
 * - Subcommands: pack, send, sync, run, status, rollback
 * - Flags: --prompt (-p), --files (-f), --all, --dry-run, --max-chars, -o/--output
 * - Interactive Terminal Mode when run without arguments
 * - Zero external runtime dependencies ($0 cost, local E:\Gematron containment)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { packContext, DEFAULT_MAX_CHARS } from './lib/context-packer.mjs';
import { ArenaCDPDriver } from './lib/arena-cdp-driver.mjs';
import { CodeSyncer } from './lib/code-syncer.mjs';

export const PROJECT_ROOT = 'E:\\Gematron';
export const DEFAULT_ARENA_URL = 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652';
export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_CDP_HOST = '127.0.0.1';
export { DEFAULT_MAX_CHARS };

/**
 * Parses command-line arguments into a structured options object.
 *
 * @param {string[]} argv - Array of argument strings (typically process.argv.slice(2))
 * @returns {object} Parsed options
 */
export function parseArgs(argv = []) {
  const options = {
    command: null,
    prompt: '',
    files: [],
    all: false,
    dryRun: false,
    maxChars: DEFAULT_MAX_CHARS,
    port: DEFAULT_CDP_PORT,
    host: DEFAULT_CDP_HOST,
    targetUrl: DEFAULT_ARENA_URL,
    output: null,
    responseFile: null,
    timestamp: null,
    ignoreSyntaxErrors: false,
    timeoutMs: 120_000,
    help: false,
  };

  const positional = [];
  const args = Array.isArray(argv) ? [...argv] : [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help' || arg === 'help') {
      options.help = true;
      if (!options.command) options.command = 'help';
      continue;
    }

    if (arg === '--pack-only') {
      options.command = 'pack';
      continue;
    }

    if (arg === '--sync-only') {
      options.command = 'sync';
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options.responseFile = args[++i];
      }
      continue;
    }

    if (arg === '--rollback') {
      options.command = 'rollback';
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options.timestamp = args[++i];
      }
      continue;
    }

    if (arg === '-p' || arg === '--prompt') {
      if (i + 1 < args.length) {
        options.prompt = args[++i];
      }
      continue;
    }

    if (arg.startsWith('--prompt=')) {
      options.prompt = arg.slice('--prompt='.length);
      continue;
    }

    if (arg === '-f' || arg === '--files') {
      if (i + 1 < args.length) {
        const next = args[++i];
        const split = next
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        options.files.push(...split);
      }
      continue;
    }

    if (arg.startsWith('--files=')) {
      const split = arg
        .slice('--files='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      options.files.push(...split);
      continue;
    }

    if (arg === '--all') {
      options.all = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--max-chars') {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[++i], 10);
        if (!isNaN(parsed) && parsed > 0) options.maxChars = parsed;
      }
      continue;
    }

    if (arg.startsWith('--max-chars=')) {
      const parsed = parseInt(arg.slice('--max-chars='.length), 10);
      if (!isNaN(parsed) && parsed > 0) options.maxChars = parsed;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      if (i + 1 < args.length) {
        options.output = args[++i];
      }
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--port') {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[++i], 10);
        if (!isNaN(parsed) && parsed > 0) options.port = parsed;
      }
      continue;
    }

    if (arg === '--host') {
      if (i + 1 < args.length) {
        options.host = args[++i];
      }
      continue;
    }

    if (arg === '--target-url') {
      if (i + 1 < args.length) {
        options.targetUrl = args[++i];
      }
      continue;
    }

    if (arg === '--timeout') {
      if (i + 1 < args.length) {
        const parsed = parseInt(args[++i], 10);
        if (!isNaN(parsed) && parsed > 0) options.timeoutMs = parsed;
      }
      continue;
    }

    if (arg === '--ignore-syntax-errors') {
      options.ignoreSyntaxErrors = true;
      continue;
    }

    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Determine command from positional if not already set
  if (!options.command && positional.length > 0) {
    const first = positional[0].toLowerCase();
    const validCommands = new Set(['pack', 'send', 'sync', 'run', 'status', 'rollback', 'help']);
    if (validCommands.has(first)) {
      options.command = first;
      positional.shift();
    }
  }

  // Default command if not explicitly provided
  if (!options.command) {
    options.command = positional.length === 0 && !options.prompt ? 'interactive' : 'run';
  }

  // Process command-specific positional arguments
  if (options.command === 'run' || options.command === 'send') {
    if (!options.prompt && positional.length > 0) {
      options.prompt = positional.shift();
    }
    if (positional.length > 0) {
      options.files.push(...positional);
    }
  } else if (options.command === 'pack') {
    if (positional.length > 0) {
      options.files.push(...positional);
    }
  } else if (options.command === 'sync') {
    if (!options.responseFile && positional.length > 0) {
      options.responseFile = positional.shift();
    }
  } else if (options.command === 'rollback') {
    if (!options.timestamp && positional.length > 0) {
      options.timestamp = positional.shift();
    }
  }

  return options;
}

/**
 * Executes the `pack` command: gathers workspace files, builds tree, and outputs prompt.
 *
 * @param {object} options
 * @param {object} [packerOverride] - Optional packContext function override for testing
 * @returns {Promise<object>} Pack result
 */
export async function runPackCommand(options = {}, packerOverride = null) {
  const packer = packerOverride || packContext;
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);

  const packResult = await packer({
    projectRoot,
    targetFiles: options.files && options.files.length > 0 ? options.files : null,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    userPrompt: options.prompt || 'Please review and update the codebase as required.',
  });

  if (options.output) {
    const outPath = path.isAbsolute(options.output)
      ? options.output
      : path.join(projectRoot, options.output);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, packResult.prompt, 'utf8');
    packResult.outputPath = outPath;
  }

  return packResult;
}

/**
 * Checks Chrome CDP connection status and Arena tab availability.
 *
 * @param {object} [options]
 * @param {object} [driverOverride] - Optional ArenaCDPDriver override
 * @returns {Promise<{ ok: boolean, cdpConnected: boolean, arenaTabOpen: boolean, tab: object|null }>}
 */
export async function runStatusCommand(options = {}, driverOverride = null) {
  const port = options.port ?? DEFAULT_CDP_PORT;
  const host = options.host ?? DEFAULT_CDP_HOST;
  const targetUrl = options.targetUrl ?? DEFAULT_ARENA_URL;

  let cdpConnected = false;
  let arenaTabOpen = false;
  let tab = null;

  try {
    const driver = driverOverride || new ArenaCDPDriver({ port, host, targetUrl });
    const tabFound = await driver.findArenaTab();

    if (tabFound) {
      cdpConnected = true;
      arenaTabOpen = true;
      tab = tabFound;
    } else {
      // Check if CDP is reachable even if Arena tab is not open
      const res = await fetch(`http://${host}:${port}/json/version`, {
        signal: AbortSignal.timeout(2000),
      }).catch(() => null);
      if (res && res.ok) {
        cdpConnected = true;
      }
    }
  } catch {
    cdpConnected = false;
  }

  return {
    ok: true,
    cdpConnected,
    arenaTabOpen,
    tab,
    port,
    host,
  };
}

/**
 * Executes the `send` command: packs context, connects to Arena tab, injects prompt, and submits.
 *
 * @param {object} options
 * @param {object} [depsOverride] - Injected dependencies { driver, packContext }
 * @returns {Promise<object>} Result
 */
export async function runSendCommand(options = {}, depsOverride = {}) {
  const packer = depsOverride.packContext || packContext;
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);

  const packResult = await packer({
    projectRoot,
    targetFiles: options.files && options.files.length > 0 ? options.files : null,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    userPrompt: options.prompt || 'Please review and update the codebase as required.',
  });

  const driver =
    depsOverride.driver ||
    new ArenaCDPDriver({
      port: options.port ?? DEFAULT_CDP_PORT,
      host: options.host ?? DEFAULT_CDP_HOST,
      targetUrl: options.targetUrl ?? DEFAULT_ARENA_URL,
    });

  const connected = await driver.connect();
  if (!connected) {
    throw new Error(
      `Failed to connect to LMSYS Arena tab on port ${options.port ?? DEFAULT_CDP_PORT}. Ensure Chrome is launched with remote debugging.`,
    );
  }

  try {
    const injectRes = await driver.injectPrompt(packResult.prompt);
    if (!injectRes.success) {
      throw new Error('Failed to inject prompt into Arena chatbox textarea');
    }

    const submitRes = await driver.submitPrompt();
    if (!submitRes.success) {
      throw new Error('Failed to submit prompt via Enter key');
    }

    return {
      success: true,
      promptLength: packResult.prompt.length,
      fileCount: packResult.fileCount,
      tab: driver.activeTab,
    };
  } finally {
    if (!depsOverride.driver) {
      await driver.disconnect().catch(() => {});
    }
  }
}

/**
 * Executes the `sync` command: ingests assistant markdown response, creates backups, and synchronizes files.
 *
 * @param {object} options
 * @param {object} [depsOverride] - Injected dependencies { driver, syncer }
 * @returns {Promise<object>} Sync result
 */
export async function runSyncCommand(options = {}, depsOverride = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const syncer = depsOverride.syncer || new CodeSyncer({ projectRoot });

  let responseText = options.responseText || '';

  if (!responseText && options.responseFile) {
    const filePath = path.isAbsolute(options.responseFile)
      ? options.responseFile
      : path.join(projectRoot, options.responseFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Response file not found: ${filePath}`);
    }
    responseText = fs.readFileSync(filePath, 'utf8');
  }

  if (!responseText) {
    // Attempt to pull latest assistant message from active Arena tab
    const driver =
      depsOverride.driver ||
      new ArenaCDPDriver({
        port: options.port ?? DEFAULT_CDP_PORT,
        host: options.host ?? DEFAULT_CDP_HOST,
        targetUrl: options.targetUrl ?? DEFAULT_ARENA_URL,
      });

    const connected = await driver.connect();
    if (!connected) {
      throw new Error('No responseText or responseFile provided, and cannot connect to Arena tab.');
    }

    try {
      const evalRes = await driver.evaluate(`
        (() => {
          const blocks = document.querySelectorAll('[data-message-author-role="assistant"], .prose, .markdown');
          if (blocks.length > 0) {
            return blocks[blocks.length - 1].innerText || '';
          }
          return '';
        })()
      `);
      responseText = evalRes || '';
    } finally {
      if (!depsOverride.driver) {
        await driver.disconnect().catch(() => {});
      }
    }
  }

  if (!responseText || !responseText.trim()) {
    throw new Error('No assistant response text found to synchronize');
  }

  const blocks = syncer.parseCodeBlocks(responseText);
  if (blocks.length === 0) {
    return {
      ok: true,
      blocksFound: 0,
      filesWritten: [],
      filesDeleted: [],
      backupPath: null,
      message: 'No code blocks with // FILE: or // DELETE_FILE: headers found.',
    };
  }

  const syncResult = await syncer.sync(blocks, {
    dryRun: options.dryRun ?? false,
    ignoreSyntaxErrors: options.ignoreSyntaxErrors ?? false,
  });

  return {
    ok: true,
    blocksFound: blocks.length,
    filesWritten: syncResult.filesWritten,
    filesDeleted: syncResult.filesDeleted,
    backupTimestamp: syncResult.backupTimestamp,
    backupPath: syncResult.backupDir,
    manifest: syncResult.manifest,
    dryRun: !!options.dryRun,
  };
}

/**
 * Executes the full autonomous loop: pack -> inject -> submit -> wait -> backup -> sync.
 *
 * @param {object} options
 * @param {object} [depsOverride] - Injected dependencies { packContext, driver, syncer }
 * @returns {Promise<object>} Complete execution report
 */
export async function runAutonomousLoop(options = {}, depsOverride = {}) {
  const startTime = Date.now();
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const packer = depsOverride.packContext || packContext;

  // 1. Pack context
  const packResult = await packer({
    projectRoot,
    targetFiles: options.files && options.files.length > 0 ? options.files : null,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    userPrompt: options.prompt || 'Please review and update the codebase as required.',
  });

  // 2. Connect to Arena tab
  const driver =
    depsOverride.driver ||
    new ArenaCDPDriver({
      port: options.port ?? DEFAULT_CDP_PORT,
      host: options.host ?? DEFAULT_CDP_HOST,
      targetUrl: options.targetUrl ?? DEFAULT_ARENA_URL,
    });

  const connected = await driver.connect();
  if (!connected) {
    throw new Error(
      `Failed to connect to LMSYS Arena tab on port ${options.port ?? DEFAULT_CDP_PORT}. Please ensure Chrome remote debugging is active and the Arena session is open.`,
    );
  }

  try {
    // 3. Inject prompt into Arena chatbox
    const injectRes = await driver.injectPrompt(packResult.prompt);
    if (!injectRes.success) {
      throw new Error('Failed to inject prompt into Arena chat textarea');
    }

    // 4. Submit prompt via trusted Enter key
    const submitRes = await driver.submitPrompt();
    if (!submitRes.success) {
      throw new Error('Failed to submit prompt to Arena session');
    }

    // 5. Monitor streaming generation until completion
    const completion = await driver.waitForCompletion({
      timeoutMs: options.timeoutMs ?? 120_000,
    });

    // 6. Ingest response, parse code blocks, create timestamped backups, and sync
    const syncer = depsOverride.syncer || new CodeSyncer({ projectRoot });
    const blocks = syncer.parseCodeBlocks(completion.text);

    let syncResult;
    if (blocks.length > 0) {
      syncResult = await syncer.sync(blocks, {
        dryRun: options.dryRun ?? false,
        ignoreSyntaxErrors: options.ignoreSyntaxErrors ?? false,
      });
    } else {
      syncResult = {
        backupTimestamp: null,
        backupDir: null,
        filesWritten: [],
        filesDeleted: [],
        manifest: null,
      };
    }

    const durationMs = Date.now() - startTime;
    const filesModified = (syncResult.filesWritten || []).concat(syncResult.filesDeleted || []);

    return {
      ok: true,
      durationMs,
      filesModified,
      filesWritten: syncResult.filesWritten || [],
      filesDeleted: syncResult.filesDeleted || [],
      backupPath: syncResult.backupDir,
      manifest: syncResult.manifest,
      blocksCount: blocks.length,
      dryRun: !!options.dryRun,
      tab: driver.activeTab,
      responseTextLength: completion.text ? completion.text.length : 0,
    };
  } finally {
    if (!depsOverride.driver) {
      await driver.disconnect().catch(() => {});
    }
  }
}

/**
 * Executes the `rollback` command: reverts workspace changes from a backup manifest.
 *
 * @param {string} timestampOrManifest
 * @param {object} [syncerOverride] - Injected CodeSyncer instance
 * @returns {Promise<object>} Rollback result
 */
export async function runRollbackCommand(timestampOrManifest, syncerOverride = null) {
  if (!timestampOrManifest) {
    throw new Error('A valid backup timestamp or path to manifest.json is required for rollback');
  }

  const syncer = syncerOverride || new CodeSyncer({ projectRoot: PROJECT_ROOT });
  const result = await syncer.rollback(timestampOrManifest);
  return {
    ok: true,
    restored: result.restored,
    removed: result.removed,
  };
}

/**
 * Displays the CLI help screen.
 */
export function printHelp() {
  console.log(`
========================================================================
  KIMI K3 AUTONOMOUS ARENA BRIDGE (E:\\Gematron)
  Zero-cost, local CDP Chrome bridge to LMSYS Chatbot Arena
========================================================================

USAGE:
  node scripts/kimi-bridge.mjs <command> [options]
  npm run kimi:bridge -- <command> [options]

COMMANDS:
  run "<prompt>" [files...]    Full loop: pack context -> inject -> wait -> backup -> sync
  pack [files...]              Pack codebase context into structured prompt
  send "<prompt>" [files...]   Pack and inject prompt into Arena tab without syncing
  sync [responseFile]          Parse markdown response, create backups, and sync changes
  status                       Check Chrome port 9222 and Arena tab availability
  rollback <timestamp>         Restore workspace from backups/kimi-history/<timestamp>/
  help                         Show this help documentation

OPTIONS:
  -p, --prompt "<text>"        Task prompt or instruction for Kimi K3
  -f, --files <f1,f2>          Comma-separated list of target files to include
  --all                        Pack entire project workspace within size limits
  --dry-run                    Simulate sync and print planned changes without writing
  --max-chars <n>              Context character budget (default: 100,000 chars)
  -o, --output <path>          Save packed prompt to a file (pack command)
  --port <port>                Chrome remote debugging port (default: 9222)
  --host <host>                Chrome remote debugging host (default: 127.0.0.1)
  --timeout <ms>               Completion timeout in milliseconds (default: 120,000)
  --ignore-syntax-errors       Bypass pre-flight syntax checks during sync

EXAMPLES:
  # Run autonomous coding loop on Desktop HUD
  npm run kimi:bridge -- run "Refactor ModelSwitchboard" apps/desktop-hud/src/renderer/ModelSwitchboard.tsx

  # Pack context to a file for manual review
  npm run kimi:bridge -- pack -o temp/context.txt apps/desktop-hud/src/main/control-server.ts

  # Sync changes from a saved Arena response file
  npm run kimi:bridge -- sync temp/response.md

  # Check Arena tab connection status
  npm run kimi:bridge -- status

  # Rollback last modification
  npm run kimi:bridge -- rollback 2026-11-09_13-00-00-000
`);
}

/**
 * Runs the interactive terminal menu.
 */
export async function startInteractiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`
========================================================================
  KIMI K3 ARENA BRIDGE — INTERACTIVE MODE
  Workspace: E:\\Gematron | Target: LMSYS Chatbot Arena (Kimi K3)
========================================================================
  [1] Run Autonomous Loop (Pack -> Inject -> Wait -> Backup -> Sync)
  [2] Pack Context to File
  [3] Send Prompt to Arena Tab
  [4] Sync Code from Arena or Response File
  [5] Check Chrome & Arena Tab Status
  [6] Rollback Workspace from Backup Snapshot
  [7] Exit
========================================================================
`);

  try {
    const choice = (await question('Select an option (1-7): ')).trim();

    if (choice === '1') {
      const prompt = (await question('Enter task prompt for Kimi K3: ')).trim();
      const filesInput = (await question('Target files (optional, comma-separated): ')).trim();
      const dryRunInput = (await question('Dry run only? (y/N): ')).trim().toLowerCase();

      const files = filesInput
        ? filesInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const dryRun = dryRunInput === 'y' || dryRunInput === 'yes';

      console.log('\n[KimiBridge] Starting autonomous loop...');
      const res = await runAutonomousLoop({ prompt, files, dryRun });
      console.log('\n[KimiBridge] Finished successfully in', res.durationMs, 'ms');
      console.log('Files modified:', res.filesModified);
      if (res.backupPath) console.log('Backup saved to:', res.backupPath);
    } else if (choice === '2') {
      const prompt = (await question('User instructions (optional): ')).trim();
      const filesInput = (await question('Target files (optional, comma-separated): ')).trim();
      const outPath =
        (await question('Output file path (default: temp/kimi-prompt.txt): ')).trim() ||
        'temp/kimi-prompt.txt';

      const files = filesInput
        ? filesInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const res = await runPackCommand({ prompt, files, output: outPath });
      console.log(
        `\n[KimiBridge] Packed ${res.fileCount} files (${res.totalChars} chars) into: ${res.outputPath}`,
      );
    } else if (choice === '3') {
      const prompt = (await question('Enter prompt to send: ')).trim();
      const filesInput = (await question('Target files (optional): ')).trim();
      const files = filesInput
        ? filesInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      console.log('\n[KimiBridge] Sending prompt to Arena...');
      const res = await runSendCommand({ prompt, files });
      console.log(`[KimiBridge] Prompt submitted successfully! (${res.promptLength} characters)`);
    } else if (choice === '4') {
      const fileInput = (
        await question('Response markdown file (leave empty to pull from Arena tab): ')
      ).trim();
      const dryRunInput = (await question('Dry run only? (y/N): ')).trim().toLowerCase();

      console.log('\n[KimiBridge] Synchronizing code changes...');
      const res = await runSyncCommand({
        responseFile: fileInput || null,
        dryRun: dryRunInput === 'y' || dryRunInput === 'yes',
      });
      console.log(`[KimiBridge] Sync complete. Blocks found: ${res.blocksFound}`);
      console.log('Files written:', res.filesWritten);
      if (res.backupPath) console.log('Backup created at:', res.backupPath);
    } else if (choice === '5') {
      console.log('\n[KimiBridge] Checking status...');
      const status = await runStatusCommand();
      console.log('Chrome CDP Port 9222 listening:', status.cdpConnected);
      console.log('Arena tab open:', status.arenaTabOpen);
      if (status.tab) {
        console.log('Tab Title:', status.tab.title);
        console.log('Tab URL:', status.tab.url);
      }
    } else if (choice === '6') {
      const ts = (await question('Enter backup timestamp (e.g. 2026-11-09_13-00-00-000): ')).trim();
      console.log(`\n[KimiBridge] Rolling back snapshot: ${ts}...`);
      const res = await runRollbackCommand(ts);
      console.log('Restored files:', res.restored);
      console.log('Removed files:', res.removed);
    } else {
      console.log('[KimiBridge] Exiting.');
    }
  } catch (err) {
    console.error('[KimiBridge] Error:', err.message);
  } finally {
    rl.close();
  }
}

/**
 * CLI Entrypoint
 *
 * @param {string[]} argv
 */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.command === 'interactive') {
    await startInteractiveMode();
    return;
  }

  try {
    switch (options.command) {
      case 'status': {
        const status = await runStatusCommand(options);
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case 'pack': {
        const res = await runPackCommand(options);
        console.log(`[KimiBridge] Packed ${res.fileCount} files (${res.totalChars} characters)`);
        if (res.outputPath) {
          console.log(`[KimiBridge] Saved prompt to: ${res.outputPath}`);
        } else {
          console.log('\n' + res.prompt);
        }
        break;
      }

      case 'send': {
        if (!options.prompt) {
          throw new Error('A prompt is required for the "send" command. Use --prompt "<text>".');
        }
        console.log(`[KimiBridge] Packing context and sending to Arena tab...`);
        const res = await runSendCommand(options);
        console.log(`[KimiBridge] Prompt submitted successfully (${res.promptLength} characters)`);
        break;
      }

      case 'sync': {
        console.log(`[KimiBridge] Ingesting and syncing changes...`);
        const res = await runSyncCommand(options);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case 'run': {
        if (!options.prompt) {
          throw new Error('A prompt is required for the "run" command. Use --prompt "<text>".');
        }
        console.log(
          `[KimiBridge] Executing autonomous loop for prompt: "${options.prompt.slice(0, 80)}..."`,
        );
        const res = await runAutonomousLoop(options);
        console.log(`[KimiBridge] Autonomous loop completed in ${res.durationMs}ms`);
        console.log(
          `[KimiBridge] Files modified (${res.filesModified.length}):`,
          res.filesModified,
        );
        if (res.backupPath) {
          console.log(`[KimiBridge] Backup preserved at: ${res.backupPath}`);
        }
        break;
      }

      case 'rollback': {
        if (!options.timestamp) {
          throw new Error('A backup timestamp or manifest path is required for rollback.');
        }
        console.log(`[KimiBridge] Rolling back snapshot: ${options.timestamp}...`);
        const res = await runRollbackCommand(options.timestamp);
        console.log(`[KimiBridge] Rollback successful. Restored ${res.restored.length} files.`);
        break;
      }

      default:
        console.error(`Unknown command: "${options.command}". Run with --help for usage.`);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[KimiBridge Error] ${err.message}`);
    process.exitCode = 1;
  }
}

// Auto-run when invoked directly from CLI
const isDirectCli =
  Boolean(process.argv[1]) &&
  path.basename(process.argv[1]).replace(/\.[cm]?[jt]s$/, '') === 'kimi-bridge';

if (isDirectCli) {
  main().catch((err) => {
    console.error('[KimiBridge Fatal]', err);
    process.exit(1);
  });
}
