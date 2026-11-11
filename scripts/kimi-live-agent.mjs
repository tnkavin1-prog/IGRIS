#!/usr/bin/env node
/**
 * Kimi Live Agent Watcher (E:\Gematron)
 * Real-time bidirectional bridge connecting LMSYS Chatbot Arena directly to local Windows filesystem.
 *
 * Enables the user to chat with Kimi K3 in Arena and have Kimi:
 * 1. Say "Yes! I have full access to your E:\Gematron workspace."
 * 2. Execute local file read/write, directory listing, searching, and commands in real time.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ArenaCDPDriver } from './lib/arena-cdp-driver.mjs';
import { CodeSyncer } from './lib/code-syncer.mjs';
import {
  PRIMING_PROMPT,
  parseToolCalls,
  executeToolCalls,
  formatToolResults,
} from './lib/kimi-agent-core.mjs';

const PROJECT_ROOT = 'E:\\Gematron';

function log(msg, color = '\x1b[36m') {
  const ts = new Date().toLocaleTimeString();
  console.log(`${color}[${ts}] [Kimi Live Agent]\x1b[0m ${msg}`);
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  return {
    prime: args.includes('--prime') || args.includes('-p'),
    noPrime: args.includes('--no-prime'),
    port: 9222,
    pollInterval: 1500,
  };
}

async function main() {
  const options = parseCliArgs();

  console.log('='.repeat(72));
  console.log('  KIMI K3 LIVE AGENT CONTROLLER (E:\\Gematron)');
  console.log('  Bidirectional Arena-to-Local PC Automation Daemon');
  console.log('='.repeat(72));

  const driver = new ArenaCDPDriver({
    port: options.port,
    host: '127.0.0.1',
  });

  const syncer = new CodeSyncer({
    projectRoot: PROJECT_ROOT,
  });

  log('Connecting to Chrome on port ' + options.port + '...');
  let connected = await driver.connect();

  if (!connected) {
    log(
      'Chrome debug port ' + options.port + ' not active. Launching Gematron Arena Chrome...',
      '\x1b[33m',
    );
    try {
      execSync(
        `powershell -ExecutionPolicy Bypass -File "${path.join(PROJECT_ROOT, 'scripts', 'launch-arena-chrome.ps1')}" -Port ${options.port}`,
        { stdio: 'inherit' },
      );
      log('Waiting for Arena page to finish loading...', '\x1b[36m');
      await new Promise((r) => setTimeout(r, 3500));
      connected = await driver.connect();
    } catch (err) {
      log(`Failed to auto-launch Chrome: ${err.message}`, '\x1b[31m');
    }
  }

  if (!connected) {
    log('Could not connect to Chrome on port ' + options.port, '\x1b[31m');
    log('Make sure Chrome is open on arena.ai via: npm run kimi:chrome', '\x1b[33m');
    process.exit(1);
  }

  const tab = driver.activeTab;
  log(`Connected to Arena tab: "${tab?.title || 'Arena'}" (${tab?.url})`, '\x1b[32m');

  // Wait up to 15s for Arena composer textarea to render
  log('Waiting for Arena chat interface to become ready...', '\x1b[36m');
  let uiReady = false;
  for (let i = 0; i < 15; i++) {
    try {
      const hasTa = await driver.evaluate(
        `Boolean(document.querySelector('textarea[name="message"]') || document.querySelector('div[data-perf-target="composer"] textarea') || document.querySelector('textarea'))`,
      );
      if (hasTa) {
        uiReady = true;
        break;
      }
    } catch {
      // Chatbox not ready yet; retry on the next poll.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!uiReady) {
    log(
      'Warning: Arena chatbox not detected yet. Make sure you are signed in or no CAPTCHA is blocking the page.',
      '\x1b[33m',
    );
  }

  // Script to inspect assistant messages from Arena DOM
  const inspectMessagesScript = `(() => {
    try {
      const primarySelectors = [
        'div[data-perf-target="message-assistant"]',
        'div[data-message-role="assistant"]',
        'div[data-role="assistant"]'
      ];

      let elements = [];
      for (const sel of primarySelectors) {
        const nodes = document.querySelectorAll(sel);
        if (nodes && nodes.length > 0) {
          elements = Array.from(nodes);
          break;
        }
      }

      if (elements.length === 0) {
        const fallbackSelectors = ['.prose', 'div[class*="prose"]', 'div[class*="markdown"]'];
        for (const sel of fallbackSelectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes && nodes.length > 0) {
            elements = Array.from(nodes);
            break;
          }
        }
      }

      // Check generating state
      const composer = document.querySelector('div[data-perf-target="composer"]') || document.body;
      const stopBtn = composer.querySelector('button[aria-label*="Stop"]')
        || composer.querySelector('button[aria-label*="stop"]')
        || composer.querySelector('button:has(svg rect)')
        || composer.querySelector('button[data-perf-target="stop"]')
        || document.querySelector('button[aria-label*="Stop"]');

      const ta = document.querySelector('textarea[name="message"]')
        || composer.querySelector('textarea');
      const isGenerating = Boolean(stopBtn) || (ta ? ta.disabled : false);

      function extractMarkdownWithFences(el) {
        try {
          const clone = el.cloneNode(true);
          const pres = clone.querySelectorAll('pre');
          const fence = String.fromCharCode(96).repeat(3);
          const nl = String.fromCharCode(10);
          pres.forEach((pre) => {
            const codeEl = pre.querySelector('code') || pre;
            const rawCode = codeEl.textContent || '';
            const langMatch = (codeEl.className || '').match(/language-([a-zA-Z0-9_-]+)/);
            const lang = langMatch ? langMatch[1] : '';
            const marker = document.createTextNode(nl + fence + lang + nl + rawCode + nl + fence + nl);
            pre.replaceWith(marker);
          });
          return (clone.innerText || clone.textContent || '').trim();
        } catch {
          return (el.innerText || el.textContent || '').trim();
        }
      }

      const messages = [];
      for (const el of elements) {
        const text = extractMarkdownWithFences(el);
        // Ignore our own injected Gematron system/feedback prompts if fallback selector caught them
        if (text && !text.startsWith('[GEMATRON ') && !messages.includes(text)) {
          messages.push(text);
        }
      }

      return {
        isGenerating,
        messagesCount: messages.length,
        lastMessage: messages.length > 0 ? messages[messages.length - 1] : '',
      };
    } catch (err) {
      return { isGenerating: false, messagesCount: 0, lastMessage: '', error: err.message };
    }
  })()`;

  // Prime the chat if requested or if this conversation has not been primed yet
  const alreadyPrimed = await driver.evaluate(
    `(document.body.innerText || '').includes('[GEMATRON LIVE AGENT PROTOCOL ACTIVATED]')`,
  );
  const shouldPrime = options.prime || (!options.noPrime && !alreadyPrimed);

  if (shouldPrime) {
    log('Priming Kimi K3 with Gematron Live Agent Protocol...', '\x1b[35m');
    await driver.injectPrompt(PRIMING_PROMPT);
    await driver.submitPrompt();
    log('Priming prompt submitted! Waiting for Kimi activation response...');
    await driver.waitForCompletion({ debounceMs: 2500, timeoutMs: 45000 });
    log('Kimi K3 is now activated as an autonomous E:\\Gematron controller!', '\x1b[32m');
  } else {
    log(
      'Chat session active. Live agent watcher is standing by for commands in Arena...',
      '\x1b[32m',
    );
  }

  // Set of processed message hashes to prevent double-execution
  const processedHashes = new Set();

  // Seed processed hashes with existing messages so we only act on new turns
  const currentInspect = await driver.evaluate(inspectMessagesScript);
  if (currentInspect.lastMessage) {
    const seedHash = crypto.createHash('sha256').update(currentInspect.lastMessage).digest('hex');
    processedHashes.add(seedHash);
  }

  log('Watching Arena tab in real-time. Type anything in Arena webchat to interact!', '\x1b[32m');

  let stableCount = 0;
  let candidateText = '';

  // Main Event Loop
  while (true) {
    await new Promise((r) => setTimeout(r, options.pollInterval));

    let state;
    try {
      state = await driver.evaluate(inspectMessagesScript);
    } catch {
      continue;
    }

    if (!state || state.isGenerating) {
      stableCount = 0;
      candidateText = '';
      continue;
    }

    const latestText = (state.lastMessage || '').trim();
    if (!latestText) continue;

    // Stability verification: ensure generation has fully settled
    if (latestText === candidateText) {
      stableCount++;
    } else {
      candidateText = latestText;
      stableCount = 1;
    }

    // Require 2 consecutive stable checks (~3 seconds)
    if (stableCount < 2) {
      continue;
    }

    const msgHash = crypto.createHash('sha256').update(latestText).digest('hex');
    if (processedHashes.has(msgHash)) {
      continue;
    }

    // Mark as processed immediately
    processedHashes.add(msgHash);

    // 1. Check for Code Blocks to sync to E:\Gematron
    let syncedFiles = [];
    try {
      if (
        latestText.includes('// FILE:') ||
        latestText.includes('# FILE:') ||
        latestText.includes('// DELETE_FILE:')
      ) {
        log('Detected code block in Kimi response. Synchronizing to E:\\Gematron...', '\x1b[33m');
        const syncResult = await syncer.syncCodeBlocks(latestText);
        syncedFiles = syncResult.filesWritten
          .map((f) => ({ relativePath: f, isDelete: false }))
          .concat(syncResult.filesDeleted.map((f) => ({ relativePath: f, isDelete: true })));

        for (const file of syncResult.filesWritten) {
          log(`[FILE WRITTEN] ${file} (backed up in backups/kimi-history/)`, '\x1b[32m');
        }
        for (const file of syncResult.filesDeleted) {
          log(`[FILE DELETED] ${file}`, '\x1b[31m');
        }
      }
    } catch (syncErr) {
      log(`Sync error: ${syncErr.message}`, '\x1b[31m');
    }

    // 2. Check for Tool Calls
    const toolCalls = parseToolCalls(latestText);
    let toolResults = [];

    if (toolCalls.length > 0) {
      log(`Detected ${toolCalls.length} tool call(s) from Kimi:`, '\x1b[35m');
      for (const call of toolCalls) {
        log(` -> ${call.type} "${call.param}"`);
      }

      toolResults = await executeToolCalls(toolCalls, PROJECT_ROOT);
      for (const res of toolResults) {
        if (res.success) {
          log(` [OK] ${res.type} ("${res.param}")`, '\x1b[32m');
        } else {
          log(` [FAIL] ${res.type} ("${res.param}"): ${res.output}`, '\x1b[31m');
        }
      }
    }

    // 3. If tools or code sync occurred, feedback results to Kimi in Arena
    if (toolResults.length > 0 || syncedFiles.length > 0) {
      const feedback = formatToolResults(toolResults, syncedFiles);
      log('Injecting execution feedback into Arena chat...', '\x1b[35m');

      try {
        await driver.injectPrompt(feedback);
        await driver.submitPrompt();
        log('Feedback sent to Kimi! Kimi is processing...', '\x1b[32m');
      } catch (injectErr) {
        log(`Failed to inject feedback: ${injectErr.message}`, '\x1b[31m');
      }
    } else {
      // Natural language response to user
      log('Kimi responded in chat. Waiting for your next input...', '\x1b[34m');
    }
  }
}

main().catch((err) => {
  console.error('\x1b[31m[Kimi Live Agent Fatal Error]:\x1b[0m', err);
  process.exit(1);
});
