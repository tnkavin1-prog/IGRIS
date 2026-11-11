/**
 * Unit Tests for Arena CDP Driver Engine (Milestone 2)
 * Tests Features 4, 5, 6, 7, 8:
 * - Raw CDP WebSocket Client (Zero-Deps, Node 24 native WebSocket + fetch)
 * - Arena Tab Discovery & URL / Session UUID matching
 * - React Prototype Value Setter Bypass
 * - Trusted Enter Submission via CDP Input.dispatchKeyEvent
 * - 3-Tier Streaming & Completion Detector (Stop toggle, 3s debounce, code fence parity)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { ArenaCDPDriver } from '../../scripts/lib/arena-cdp-driver.mjs';

describe('ArenaCDPDriver Unit Tests', () => {
  let mockServer;
  let mockWss;
  let serverPort;
  let mockTabs = [];
  let cdpCommandHandlers = new Map();
  let receivedCdpCommands = [];

  // Helper to start the mock CDP HTTP and WebSocket server on an ephemeral port
  before(async () => {
    mockServer = http.createServer((req, res) => {
      if (req.url === '/json' || req.url === '/json/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mockTabs));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    });

    mockWss = new WebSocketServer({ noServer: true });

    mockServer.on('upgrade', (req, socket, head) => {
      mockWss.handleUpgrade(req, socket, head, (ws) => {
        mockWss.emit('connection', ws, req);
      });
    });

    mockWss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          receivedCdpCommands.push(msg);

          const customHandler = cdpCommandHandlers.get(msg.method);
          if (customHandler) {
            const result = customHandler(msg.params, msg.id, ws);
            if (result !== undefined) {
              ws.send(JSON.stringify({ id: msg.id, result }));
            }
          } else {
            // Default response
            ws.send(JSON.stringify({ id: msg.id, result: { success: true } }));
          }
        } catch {
          ws.send(JSON.stringify({ error: { code: -32700, message: 'Parse error' } }));
        }
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        serverPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    mockWss.close();
    await new Promise((resolve) => mockServer.close(resolve));
  });

  beforeEach(() => {
    receivedCdpCommands = [];
    cdpCommandHandlers.clear();
    mockTabs = [
      {
        id: 'arena-tab-1',
        type: 'page',
        title: 'Chatbot Arena | Free AI Chat',
        url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
        webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/arena-tab-1`,
      },
      {
        id: 'other-tab-2',
        type: 'page',
        title: 'Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Main_Page',
        webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/other-tab-2`,
      },
      {
        id: 'bg-worker-3',
        type: 'service_worker',
        title: 'Extension SW',
        url: 'chrome-extension://abc/background.js',
        webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/bg-worker-3`,
      },
    ];
  });

  describe('Feature 4: Interface Contract & Configuration', () => {
    it('initializes with default options and correct baseUrl', () => {
      const driver = new ArenaCDPDriver();
      assert.equal(driver.port, 9222);
      assert.equal(driver.host, '127.0.0.1');
      assert.equal(driver.baseUrl, 'http://127.0.0.1:9222');
      assert.equal(driver.targetUrl, 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652');
      assert.equal(driver.isConnected, false);
      assert.equal(driver.activeTab, null);
    });

    it('accepts custom port, host, and targetUrl options', () => {
      const driver = new ArenaCDPDriver({
        port: 9333,
        host: 'localhost',
        targetUrl: 'https://arena.ai/custom-session',
      });
      assert.equal(driver.port, 9333);
      assert.equal(driver.host, 'localhost');
      assert.equal(driver.baseUrl, 'http://localhost:9333');
      assert.equal(driver.targetUrl, 'https://arena.ai/custom-session');
    });

    it('implements all methods required by PROJECT.md interface contract', () => {
      const driver = new ArenaCDPDriver();
      assert.equal(typeof driver.connect, 'function');
      assert.equal(typeof driver.findArenaTab, 'function');
      assert.equal(typeof driver.injectPrompt, 'function');
      assert.equal(typeof driver.submitPrompt, 'function');
      assert.equal(typeof driver.waitForCompletion, 'function');
      assert.equal(typeof driver.disconnect, 'function');
      assert.equal(typeof driver.sendCDPCommand, 'function');
      assert.equal(typeof driver.evaluate, 'function');
    });
  });

  describe('Feature 5: Arena Tab Discovery', () => {
    it('locates Arena tab by session UUID and filters out background targets', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      const tab = await driver.findArenaTab();

      assert.ok(tab, 'Expected to find Arena tab');
      assert.equal(tab.id, 'arena-tab-1');
      assert.equal(tab.url, 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652');
      assert.equal(
        tab.webSocketDebuggerUrl,
        `ws://127.0.0.1:${serverPort}/devtools/page/arena-tab-1`,
      );
      assert.equal(driver.activeTab.id, 'arena-tab-1');
    });

    it('locates Arena tab when matching general arena.ai domain', async () => {
      mockTabs = [
        {
          id: 'generic-arena',
          type: 'page',
          title: 'Arena AI',
          url: 'https://arena.ai/direct-chat',
          webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/generic-arena`,
        },
      ];

      const driver = new ArenaCDPDriver({
        port: serverPort,
        targetUrl: 'https://arena.ai/direct-chat',
      });
      const tab = await driver.findArenaTab();

      assert.ok(tab);
      assert.equal(tab.id, 'generic-arena');
    });

    it('generates fallback webSocketDebuggerUrl if missing in target JSON', async () => {
      mockTabs = [
        {
          id: 'no-ws-tab',
          type: 'page',
          title: 'Arena AI',
          url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
          // webSocketDebuggerUrl omitted
        },
      ];

      const driver = new ArenaCDPDriver({ port: serverPort });
      const tab = await driver.findArenaTab();

      assert.ok(tab);
      assert.equal(
        tab.webSocketDebuggerUrl,
        `ws://127.0.0.1:${serverPort}/devtools/page/no-ws-tab`,
      );
    });

    it('returns null when no matching tab is found', async () => {
      mockTabs = [
        {
          id: 'unrelated',
          type: 'page',
          title: 'Google',
          url: 'https://google.com',
          webSocketDebuggerUrl: `ws://127.0.0.1:${serverPort}/devtools/page/unrelated`,
        },
      ];

      const driver = new ArenaCDPDriver({ port: serverPort });
      const tab = await driver.findArenaTab();
      assert.equal(tab, null);
    });

    it('returns null safely when Chrome port is unreachable without throwing', async () => {
      // Port 59999 is intentionally unused
      const driver = new ArenaCDPDriver({ port: 59999 });
      const tab = await driver.findArenaTab();
      assert.equal(tab, null);
    });
  });

  describe('Feature 4: Raw CDP WebSocket Connection & RPC', () => {
    it('connects to mock WebSocket server and tracks connection state', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      let connectedEmitted = false;
      driver.on('connected', (tab) => {
        connectedEmitted = true;
        assert.equal(tab.id, 'arena-tab-1');
      });

      const ok = await driver.connect();
      assert.equal(ok, true);
      assert.equal(driver.isConnected, true);
      assert.equal(connectedEmitted, true);

      // Subsequent connect call when already connected returns true
      const secondOk = await driver.connect();
      assert.equal(secondOk, true);

      await driver.disconnect();
      assert.equal(driver.isConnected, false);
      assert.equal(driver.activeTab, null);
    });

    it('sends CDP command and receives correlated result', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      cdpCommandHandlers.set('Page.getTitle', () => ({
        title: 'Mock Page Title',
      }));

      const res = await driver.sendCDPCommand('Page.getTitle');
      assert.deepEqual(res, { title: 'Mock Page Title' });

      assert.equal(receivedCdpCommands.length, 1);
      assert.equal(receivedCdpCommands[0].method, 'Page.getTitle');

      await driver.disconnect();
    });

    it('handles CDP error responses properly', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      cdpCommandHandlers.set('Runtime.evaluate', (params, id, ws) => {
        ws.send(
          JSON.stringify({
            id,
            error: { code: -32000, message: 'Cannot evaluate on null document' },
          }),
        );
        return undefined; // Handled directly
      });

      await assert.rejects(async () => {
        await driver.sendCDPCommand('Runtime.evaluate', { expression: 'null.foo' });
      }, /CDP error -32000: Cannot evaluate on null document/);

      await driver.disconnect();
    });

    it('throws when sendCDPCommand is invoked before connecting', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await assert.rejects(async () => {
        await driver.sendCDPCommand('Page.enable');
      }, /Cannot send CDP command 'Page.enable': WebSocket is not connected/);
    });

    it('evaluate() unwraps result value and throws on runtime exceptions', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      cdpCommandHandlers.set('Runtime.evaluate', (params) => {
        if (params.expression.includes('throw new Error')) {
          return {
            result: { type: 'undefined' },
            exceptionDetails: {
              text: 'Uncaught',
              exception: { description: 'Error: Evaluation exploded' },
            },
          };
        }
        return {
          result: { type: 'number', value: 42 },
        };
      });

      const value = await driver.evaluate('21 * 2');
      assert.equal(value, 42);

      await assert.rejects(async () => {
        await driver.evaluate('throw new Error("fail")');
      }, /Runtime.evaluate exception: Error: Evaluation exploded/);

      await driver.disconnect();
    });
  });

  describe('Feature 6: React Value Setter Bypass (injectPrompt)', () => {
    it('evaluates React prototype descriptor bypass with exact prompt text and event dispatch', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      let executedExpression = '';
      cdpCommandHandlers.set('Runtime.evaluate', (params) => {
        executedExpression = params.expression;
        return {
          result: { value: { success: true } },
        };
      });

      const promptText = 'Test prompt for Kimi K3\nLine 2 with "quotes" and `backticks`.';
      const result = await driver.injectPrompt(promptText);

      assert.equal(result.success, true);
      assert.ok(executedExpression.includes('Object.getOwnPropertyDescriptor'));
      assert.ok(executedExpression.includes('HTMLTextAreaElement.prototype'));
      assert.ok(executedExpression.includes('descriptor.set.call(ta, valueToSet)'));
      assert.ok(executedExpression.includes("new InputEvent('input'"));
      assert.ok(executedExpression.includes("inputType: 'insertText'"));
      assert.ok(executedExpression.includes("new Event('change'"));
      assert.ok(executedExpression.includes('Test prompt for Kimi K3'));

      await driver.disconnect();
    });

    it('returns failure when textarea element is missing in DOM', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      cdpCommandHandlers.set('Runtime.evaluate', () => ({
        result: {
          value: { success: false, error: 'Arena textarea element not found in DOM.' },
        },
      }));

      const res = await driver.injectPrompt('Hello');
      assert.equal(res.success, false);
      assert.match(res.error, /textarea element not found/i);

      await driver.disconnect();
    });

    it('throws when injectPrompt is called while disconnected', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await assert.rejects(async () => {
        await driver.injectPrompt('Sample text');
      }, /ArenaCDPDriver is not connected/);
    });
  });

  describe('Feature 7: Trusted Enter Submission (submitPrompt)', () => {
    it('dispatches authentic rawKeyDown and keyUp for Enter (keyCode 13)', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      const keyEvents = [];
      cdpCommandHandlers.set('Input.dispatchKeyEvent', (params) => {
        keyEvents.push(params);
        return {};
      });

      const res = await driver.submitPrompt();
      assert.equal(res.success, true);

      assert.equal(keyEvents.length, 2);

      // Event 1: rawKeyDown
      assert.equal(keyEvents[0].type, 'rawKeyDown');
      assert.equal(keyEvents[0].windowsVirtualKeyCode, 13);
      assert.equal(keyEvents[0].key, 'Enter');
      assert.equal(keyEvents[0].code, 'Enter');

      // Event 2: keyUp
      assert.equal(keyEvents[1].type, 'keyUp');
      assert.equal(keyEvents[1].windowsVirtualKeyCode, 13);
      assert.equal(keyEvents[1].key, 'Enter');
      assert.equal(keyEvents[1].code, 'Enter');

      await driver.disconnect();
    });

    it('throws when submitPrompt is called while disconnected', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await assert.rejects(async () => {
        await driver.submitPrompt();
      }, /ArenaCDPDriver is not connected/);
    });
  });

  describe('Feature 8: Streaming & Completion Detector (waitForCompletion)', () => {
    it('detects completion via Stop button toggle, debounce stability, and even code fence parity', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      // State sequence representing streaming generation
      const responses = [
        // Poll 1: Generation started, Stop button visible, partial markdown
        {
          isGenerating: true,
          hasStopButton: true,
          isTextareaDisabled: true,
          text: 'Here is your solution:\n```javascript\nfunction hello() {\n',
        },
        // Poll 2: Still generating, code block still open (odd count of ```)
        {
          isGenerating: false, // UI temporarily toggling
          hasStopButton: false,
          isTextareaDisabled: false,
          text: 'Here is your solution:\n```javascript\nfunction hello() { return "world"; }\n',
        },
        // Poll 3: Finished, code block closed with ``` (even count: 2), Stop button gone
        {
          isGenerating: false,
          hasStopButton: false,
          isTextareaDisabled: false,
          text: 'Here is your solution:\n```javascript\nfunction hello() { return "world"; }\n```\nDone!',
        },
        // Poll 4+: Text remains stable across debounce window
        {
          isGenerating: false,
          hasStopButton: false,
          isTextareaDisabled: false,
          text: 'Here is your solution:\n```javascript\nfunction hello() { return "world"; }\n```\nDone!',
        },
      ];

      let pollIndex = 0;
      cdpCommandHandlers.set('Runtime.evaluate', () => {
        const state = responses[Math.min(pollIndex, responses.length - 1)];
        pollIndex++;
        return { result: { value: state } };
      });

      const chunksEmitted = [];
      driver.on('chunk', (chunk) => {
        chunksEmitted.push(chunk);
      });

      const completion = await driver.waitForCompletion({
        pollIntervalMs: 50,
        debounceMs: 150,
        timeoutMs: 5000,
      });

      assert.ok(completion.text.includes('function hello() { return "world"; }'));
      assert.ok(completion.durationMs >= 150);
      assert.ok(chunksEmitted.length >= 2, 'Expected streaming chunks to be emitted');

      await driver.disconnect();
    });

    it('code fence parity helper correctly distinguishes even and odd code blocks', () => {
      // 0 fences -> even (true)
      assert.equal(ArenaCDPDriver.isCodeFenceParityEven('Simple text with no code'), true);

      // 1 fence -> odd (false, incomplete block)
      assert.equal(ArenaCDPDriver.isCodeFenceParityEven('```javascript\nconsole.log(1);'), false);

      // 2 fences -> even (true, closed block)
      assert.equal(
        ArenaCDPDriver.isCodeFenceParityEven('```javascript\nconsole.log(1);\n```'),
        true,
      );

      // 3 fences -> odd (false, second block incomplete)
      assert.equal(
        ArenaCDPDriver.isCodeFenceParityEven(
          '```js\nconst a = 1;\n```\nExplanation...\n```python\nprint(2)',
        ),
        false,
      );

      // 4 fences -> even (true, two closed blocks)
      assert.equal(
        ArenaCDPDriver.isCodeFenceParityEven('```js\nconst a = 1;\n```\n```python\nprint(2)\n```'),
        true,
      );
    });

    it('rejects completion until code fence parity becomes even', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      // Model stopped generating in UI, but has an odd code fence delimiter
      // Next poll, the missing delimiter is present
      let pollCount = 0;
      cdpCommandHandlers.set('Runtime.evaluate', () => {
        pollCount++;
        if (pollCount < 3) {
          return {
            result: {
              value: {
                isGenerating: false,
                hasStopButton: false,
                isTextareaDisabled: false,
                text: '```typescript\nexport const x = 1;', // 1 fence = odd
              },
            },
          };
        }
        return {
          result: {
            value: {
              isGenerating: false,
              hasStopButton: false,
              isTextareaDisabled: false,
              text: '```typescript\nexport const x = 1;\n```', // 2 fences = even
            },
          },
        };
      });

      const res = await driver.waitForCompletion({
        pollIntervalMs: 50,
        debounceMs: 120,
        timeoutMs: 3000,
      });

      assert.ok(res.text.endsWith('```'));
      assert.ok(pollCount >= 3, 'Must have waited for even code fences');

      await driver.disconnect();
    });

    it('times out when model generation never concludes', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      // Always reporting generating
      cdpCommandHandlers.set('Runtime.evaluate', () => ({
        result: {
          value: {
            isGenerating: true,
            hasStopButton: true,
            isTextareaDisabled: true,
            text: 'Still generating...',
          },
        },
      }));

      await assert.rejects(async () => {
        await driver.waitForCompletion({
          pollIntervalMs: 40,
          debounceMs: 100,
          timeoutMs: 250,
        });
      }, /waitForCompletion timed out after 250ms/);

      await driver.disconnect();
    });
  });

  describe('Resilience and Out-of-Order Message Correlation', () => {
    it('handles multiple concurrent CDP commands correlated by ID', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      cdpCommandHandlers.set('Test.Command', (params, id, ws) => {
        // Delay response inversely by ID to force out-of-order responses
        const delay = (5 - params.order) * 20;
        setTimeout(() => {
          ws.send(JSON.stringify({ id, result: { orderEcho: params.order } }));
        }, delay);
        return undefined; // Handled asynchronously
      });

      const promises = [
        driver.sendCDPCommand('Test.Command', { order: 1 }),
        driver.sendCDPCommand('Test.Command', { order: 2 }),
        driver.sendCDPCommand('Test.Command', { order: 3 }),
      ];

      const results = await Promise.all(promises);
      assert.equal(results[0].orderEcho, 1);
      assert.equal(results[1].orderEcho, 2);
      assert.equal(results[2].orderEcho, 3);

      await driver.disconnect();
    });

    it('cleans up pending requests when server closes connection', async () => {
      const driver = new ArenaCDPDriver({ port: serverPort });
      await driver.connect();

      // Don't respond to this command
      cdpCommandHandlers.set('Hanging.Command', () => undefined);

      const pendingPromise = driver.sendCDPCommand('Hanging.Command', {}, 10000);

      // Abruptly terminate socket from client
      await driver.disconnect();

      await assert.rejects(async () => {
        await pendingPromise;
      }, /ArenaCDPDriver disconnected/);
    });
  });
});
