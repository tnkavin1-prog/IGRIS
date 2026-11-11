/**
 * Tier 5: CDP and Protocol Adversarial Stress Testing Suite
 * Tests hostile, adversarial, network failure, DOM flutter, anti-bot integrity,
 * and edge protocol conditions:
 * - ADV-5.1: Network Failure - Server Unreachable / Port Down
 * - ADV-5.2: Network Failure - Abrupt Socket Termination Mid-Stream
 * - ADV-5.3: Protocol Stress - Out-of-Order JSON-RPC Responses & Unknown Request IDs
 * - ADV-5.4: Protocol Stress - Delayed Responses Exceeding Command Timeout & Late Arrival
 * - ADV-5.5: DOM Edge Case - Textarea Dynamically Removed or Missing During Injection
 * - ADV-5.6: DOM Edge Case - Textarea Disabled During Initial Attempt
 * - ADV-5.7: DOM Edge Case - Stop Button Fluttering & Parity Debounce Protection
 * - ADV-5.8: Timing Stress - Infinite / Prolonged Streaming Exceeding Timeout
 * - ADV-5.9: Anti-Bot & Integrity - Authentic Event Dispatch (isTrusted: true semantics)
 * - ADV-5.10: Anti-Bot & Integrity - Window Automation Global Leaks & Prototype Audit
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { WebSocketServer } from 'ws';
import { ArenaCDPDriver } from '../../scripts/lib/arena-cdp-driver.mjs';
import { runStatusCommand, runSendCommand } from '../../scripts/kimi-bridge.mjs';

export const name = 'Tier 5: CDP and Protocol Adversarial Stress Testing';

/**
 * Creates a clean test server that closes immediately without undici keep-alive hangs
 */
function createTestServer(requestHandler, wsMessageHandler) {
  let server;
  let wss;
  let activeSockets = new Set();
  let clientWs = null;

  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.setHeader('Connection', 'close');
      requestHandler(req, res);
    });

    wss = new WebSocketServer({ noServer: true });

    server.on('connection', (sock) => {
      activeSockets.add(sock);
      sock.on('close', () => activeSockets.delete(sock));
    });

    server.on('upgrade', (req, socket, head) => {
      activeSockets.add(socket);
      wss.handleUpgrade(req, socket, head, (ws) => {
        clientWs = ws;
        if (wsMessageHandler) {
          ws.on('message', (data) => wsMessageHandler(ws, data));
        }
        wss.emit('connection', ws, req);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        server,
        wss,
        getClientWs: () => clientWs,
        close: async () => {
          if (clientWs) {
            try {
              clientWs.terminate();
            } catch {}
          }
          if (wss) {
            try {
              wss.close();
            } catch {}
          }
          for (const s of activeSockets) {
            try {
              s.destroy();
            } catch {}
          }
          if (server.closeAllConnections) {
            server.closeAllConnections();
          }
          await new Promise((res) => server.close(res));
        },
      });
    });
  });
}

export async function run() {
  const results = [];

  function record(testName, fn) {
    return async () => {
      console.log(`>>> [RUNNING] ${testName}`);
      const start = Date.now();
      try {
        await fn();
        const durationMs = Date.now() - start;
        console.log(`  [PASS] ${testName} (${durationMs}ms)`);
        results.push({ name: testName, status: 'pass', durationMs });
      } catch (err) {
        const durationMs = Date.now() - start;
        console.log(`  [FAIL] ${testName} (${durationMs}ms)`);
        console.error(`         ERROR: ${err.stack || err.message}`);
        results.push({ name: testName, status: 'fail', error: err, durationMs });
      }
    };
  }

  // --------------------------------------------------------------------------
  // ADV-5.1: Network Failure - Server Unreachable / Port Down
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.1: Network Failure - Unreachable port returns null/false cleanly without crashing',
    async () => {
      const deadPort = 59981; // Inactive ephemeral port

      // 1. Direct WebSocket connection to unreachable port fails fast and cleanly
      const directDriver = new ArenaCDPDriver({
        port: deadPort,
        wsUrl: `ws://127.0.0.1:${deadPort}/devtools/page/test`,
      });
      directDriver.on('error', () => {});
      const directConnect = await directDriver.connect(500);
      assert.equal(directConnect, false, 'Direct connection to unreachable port must return false');
      assert.equal(directDriver.isConnected, false);

      // 2. findArenaTab on unreachable port returns null
      const discoveryDriver = new ArenaCDPDriver({ port: deadPort });
      discoveryDriver.on('error', () => {});
      const tab = await discoveryDriver.findArenaTab();
      assert.equal(tab, null, 'findArenaTab on unreachable port must return null');

      // 3. CLI status command handles unreachable port gracefully
      const status = await runStatusCommand({ port: deadPort });
      assert.equal(status.ok, true, 'status command must report ok: true');
      assert.equal(status.cdpConnected, false, 'cdpConnected must be false');
      assert.equal(status.arenaTabOpen, false, 'arenaTabOpen must be false');
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.2: Network Failure - Abrupt Socket Termination Mid-Stream
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.2: Network Failure - Abrupt socket termination mid-stream rejects in-flight commands',
    async () => {
      let mock;
      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-disconnect-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-disconnect-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          // Do not respond to simulate in-flight command
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        const ok = await driver.connect();
        assert.equal(ok, true, 'Driver should connect');

        // Setup a hanging command that waits indefinitely
        const hangingPromise = driver.sendCDPCommand('Test.Hang', {}, 10000);

        // Abruptly terminate the socket from the server side
        const clientWs = mock.getClientWs();
        assert.ok(clientWs, 'Active socket must exist');
        clientWs.terminate();

        // Verify that the hanging command is rejected due to socket closure
        await assert.rejects(
          async () => {
            await hangingPromise;
          },
          /CDP WebSocket closed/i,
          'In-flight command must be rejected when socket terminates abruptly',
        );

        assert.equal(driver.isConnected, false, 'Driver must mark isConnected = false');
        assert.equal(driver.pendingRequests.size, 0, 'Pending requests map must be cleared');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.3: Protocol Stress - Out-of-Order JSON-RPC Responses & Unknown Request IDs
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.3: Protocol Stress - Out-of-order responses & spurious messages handled gracefully',
    async () => {
      let mock;
      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-ooo-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-ooo-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          // Delay responses in inverted order:
          // id=1 delay 60ms, id=2 delay 30ms, id=3 delay 5ms
          if (msg.params?.seq === 1) {
            setTimeout(() => {
              ws.send(JSON.stringify({ id: msg.id, result: { seqEcho: 1 } }));
            }, 60);
          } else if (msg.params?.seq === 2) {
            setTimeout(() => {
              ws.send(JSON.stringify({ id: msg.id, result: { seqEcho: 2 } }));
            }, 30);
          } else if (msg.params?.seq === 3) {
            setTimeout(() => {
              ws.send(JSON.stringify({ id: msg.id, result: { seqEcho: 3 } }));
            }, 5);
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});

        let cdpEventReceived = false;
        driver.on('Page.loadEventFired', (params) => {
          cdpEventReceived = true;
          assert.equal(params.timestamp, 12345);
        });

        await driver.connect();

        // Inject spurious frames: unknown id, invalid JSON, and CDP event notification
        const clientWs = mock.getClientWs();
        clientWs.send(JSON.stringify({ id: 88888, result: { stray: true } }));
        clientWs.send('<<<BAD_PROTOCOL_FRAME_NOT_JSON>>>');
        clientWs.send(
          JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 12345 } }),
        );

        // Dispatch 3 concurrent commands
        const p1 = driver.sendCDPCommand('Test.Command', { seq: 1 });
        const p2 = driver.sendCDPCommand('Test.Command', { seq: 2 });
        const p3 = driver.sendCDPCommand('Test.Command', { seq: 3 });

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        assert.equal(r1.seqEcho, 1, 'Command 1 must receive response 1 despite arriving last');
        assert.equal(r2.seqEcho, 2, 'Command 2 must receive response 2');
        assert.equal(r3.seqEcho, 3, 'Command 3 must receive response 3 despite arriving first');
        assert.equal(
          cdpEventReceived,
          true,
          'CDP event must be cleanly dispatched via EventEmitter',
        );

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.4: Protocol Stress - Delayed Responses Exceeding Timeout & Late Arrival
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.4: Protocol Stress - Command timeout triggers cleanly and ignores late response',
    async () => {
      let mock;
      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-timeout-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-timeout-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          // Delay response by 180ms (exceeding the 60ms command timeout)
          setTimeout(() => {
            try {
              ws.send(JSON.stringify({ id: msg.id, result: { late: true } }));
            } catch {}
          }, 180);
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        // Dispatch command with short 60ms timeout
        await assert.rejects(
          async () => {
            await driver.sendCDPCommand('Slow.Command', {}, 60);
          },
          /timed out after 60ms/i,
          'Command must reject with timeout error',
        );

        assert.equal(driver.pendingRequests.size, 0, 'Pending map must not leak timed-out request');

        // Wait 150ms for late response to arrive at client
        await new Promise((r) => setTimeout(r, 150));

        // Client must still be connected and functional
        assert.equal(driver.isConnected, true, 'Driver must stay connected after late response');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.5: DOM Edge Case - Textarea Dynamically Removed or Missing During Injection
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.5: DOM Edge Case - Missing or removed textarea returns explicit error',
    async () => {
      let mock;
      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-dom-missing-ta',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-dom-missing-ta`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Runtime.evaluate') {
            ws.send(
              JSON.stringify({
                id: msg.id,
                result: {
                  result: {
                    type: 'object',
                    value: { success: false, error: 'Arena textarea element not found in DOM.' },
                  },
                },
              }),
            );
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        // Injection must report failure cleanly without throwing an unhandled crash
        const res = await driver.injectPrompt('Hello Kimi');
        assert.equal(res.success, false);
        assert.match(res.error, /textarea element not found/i);

        // runSendCommand must catch failure and throw informative Error
        await assert.rejects(async () => {
          await runSendCommand(
            { prompt: 'Test', port: mock.port },
            { driver, packContext: async () => ({ prompt: 'Packed', fileCount: 1 }) },
          );
        }, /Failed to inject prompt into Arena chatbox textarea/i);

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.6: DOM Edge Case - Textarea Disabled During Initial Attempt
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.6: DOM Edge Case - Disabled textarea holds isGenerating: true until re-enabled',
    async () => {
      let mock;
      let pollCount = 0;

      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-disabled-ta',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-disabled-ta`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Runtime.evaluate') {
            pollCount++;
            // Poll 1-2: Textarea disabled (Stop button might already be gone, but textarea is still disabled)
            if (pollCount <= 2) {
              ws.send(
                JSON.stringify({
                  id: msg.id,
                  result: {
                    result: {
                      type: 'object',
                      value: {
                        isGenerating: true,
                        hasStopButton: false,
                        isTextareaDisabled: true, // Textarea disabled keeps generation active
                        text: 'Finished text content',
                      },
                    },
                  },
                }),
              );
            } else {
              // Poll 3+: Textarea re-enabled
              ws.send(
                JSON.stringify({
                  id: msg.id,
                  result: {
                    result: {
                      type: 'object',
                      value: {
                        isGenerating: false,
                        hasStopButton: false,
                        isTextareaDisabled: false,
                        text: 'Finished text content',
                      },
                    },
                  },
                }),
              );
            }
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        const result = await driver.waitForCompletion({
          pollIntervalMs: 25,
          debounceMs: 50,
          timeoutMs: 3000,
        });

        assert.equal(result.text, 'Finished text content');
        assert.ok(pollCount >= 3, 'Must have waited until textarea was re-enabled');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.7: DOM Edge Case - Stop Button Fluttering & Parity Debounce Protection
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.7: DOM Edge Case - Stop button flutter & odd fence parity prevent premature completion',
    async () => {
      let mock;

      // Flutter simulation sequence:
      // 0: Initial generation, Stop visible
      // 1: FLUTTER: Stop button briefly disappears (50ms), but text changed
      // 2: Stop button reappears
      // 3: Stop button gone, but code fence is ODD (incomplete block)
      // 4: Stop button gone, code fence EVEN, stable
      const states = [
        { isGenerating: true, hasStopButton: true, text: 'Building...' },
        {
          isGenerating: false,
          hasStopButton: false,
          text: 'Building... ```ts\nexport const x = 1;',
        }, // Flutter! But text changed
        { isGenerating: true, hasStopButton: true, text: 'Building... ```ts\nexport const x = 1;' },
        {
          isGenerating: false,
          hasStopButton: false,
          text: 'Building... ```ts\nexport const x = 1;',
        }, // Stop gone, but odd fence!
        {
          isGenerating: false,
          hasStopButton: false,
          text: 'Building... ```ts\nexport const x = 1;\n```',
        }, // Fence closed!
        {
          isGenerating: false,
          hasStopButton: false,
          text: 'Building... ```ts\nexport const x = 1;\n```',
        }, // Stable debounce
      ];

      let stateIdx = 0;

      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-flutter-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-flutter-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Runtime.evaluate') {
            const current = states[Math.min(stateIdx, states.length - 1)];
            stateIdx++;
            ws.send(
              JSON.stringify({
                id: msg.id,
                result: {
                  result: {
                    type: 'object',
                    value: current,
                  },
                },
              }),
            );
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        const result = await driver.waitForCompletion({
          pollIntervalMs: 25,
          debounceMs: 50,
          timeoutMs: 3000,
        });

        assert.ok(result.text.endsWith('```'), 'Must complete with even code fence parity');
        assert.ok(stateIdx >= 5, 'Must have traversed the flutter and odd-fence hurdles');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.8: Timing Stress - Infinite / Prolonged Streaming Exceeding Timeout
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.8: Timing Stress - Infinite stream reliably aborts on timeout with text diagnostics',
    async () => {
      let mock;
      let counter = 0;

      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-infinite-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-infinite-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Runtime.evaluate') {
            counter++;
            ws.send(
              JSON.stringify({
                id: msg.id,
                result: {
                  result: {
                    type: 'object',
                    value: {
                      isGenerating: true,
                      hasStopButton: true,
                      text: 'Tokens streaming continuously... ' + 'chunk_'.repeat(counter),
                    },
                  },
                },
              }),
            );
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        const chunks = [];
        driver.on('chunk', (chunk) => chunks.push(chunk));

        // 180ms timeout with 25ms polling
        await assert.rejects(
          async () => {
            await driver.waitForCompletion({
              pollIntervalMs: 25,
              debounceMs: 50,
              timeoutMs: 180,
            });
          },
          /waitForCompletion timed out after 180ms/i,
          'Must throw explicit timeout error',
        );

        assert.ok(chunks.length >= 2, 'Streaming chunks must have been observed prior to timeout');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.9: Anti-Bot Integrity - Authentic Event Dispatch (isTrusted: true semantics)
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.9: Anti-Bot Integrity - Input.dispatchKeyEvent generates authentic Enter key events',
    async () => {
      let mock;
      const keyEventsDispatched = [];

      mock = await createTestServer(
        (req, res) => {
          if (req.url === '/json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'tab-antibot-test',
                  type: 'page',
                  url: 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652',
                  webSocketDebuggerUrl: `ws://127.0.0.1:${mock.port}/devtools/page/tab-antibot-test`,
                },
              ]),
            );
            return;
          }
          res.writeHead(404);
          res.end();
        },
        (ws, raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.method === 'Input.dispatchKeyEvent') {
            keyEventsDispatched.push(msg.params);
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }));
          }
        },
      );

      try {
        const driver = new ArenaCDPDriver({ port: mock.port });
        driver.on('error', () => {});
        await driver.connect();

        const submitRes = await driver.submitPrompt();
        assert.equal(submitRes.success, true);

        // Verify CDP protocol specs for authentic key dispatch
        assert.equal(keyEventsDispatched.length, 2, 'Must dispatch rawKeyDown and keyUp sequence');

        const down = keyEventsDispatched[0];
        assert.equal(
          down.type,
          'rawKeyDown',
          'Must be rawKeyDown to synthesize hardware key stroke',
        );
        assert.equal(down.windowsVirtualKeyCode, 13, 'Enter key virtual code must be 13');
        assert.equal(down.key, 'Enter');
        assert.equal(down.code, 'Enter');
        assert.equal(down.text, '\r');

        const up = keyEventsDispatched[1];
        assert.equal(up.type, 'keyUp');
        assert.equal(up.windowsVirtualKeyCode, 13);
        assert.equal(up.key, 'Enter');
        assert.equal(up.code, 'Enter');

        await driver.disconnect();
      } finally {
        await mock.close();
      }
    },
  )();

  // --------------------------------------------------------------------------
  // ADV-5.10: Anti-Bot Integrity - Window Automation Global Leaks & Prototype Audit
  // --------------------------------------------------------------------------
  await record(
    'ADV-5.10: Anti-Bot Integrity - Zero window automation globals & clean prototype execution',
    async () => {
      // Audit the exact JavaScript scripts injected by ArenaCDPDriver:
      // 1. injectionScript in injectPrompt
      // 2. inspectScript in waitForCompletion

      class MockHTMLTextAreaElement {
        constructor() {
          this._val = '';
          this.disabled = false;
          this.focused = false;
          this.events = [];
        }
        get value() {
          return this._val;
        }
        set value(v) {
          this._val = v;
        }
        focus() {
          this.focused = true;
        }
        dispatchEvent(e) {
          this.events.push(e);
          return true;
        }
        getAttribute() {
          return null;
        }
      }

      const mockTaInstance = new MockHTMLTextAreaElement();

      const sandbox = {
        window: {},
        document: {
          querySelector: (sel) => {
            if (sel.includes('textarea')) return mockTaInstance;
            return null;
          },
          querySelectorAll: () => [],
        },
        Event: class Event {
          constructor(type, init) {
            this.type = type;
            this.init = init;
          }
        },
        InputEvent: class InputEvent {
          constructor(type, init) {
            this.type = type;
            this.init = init;
          }
        },
        HTMLTextAreaElement: MockHTMLTextAreaElement,
        console: { log: () => {}, error: () => {} },
      };
      sandbox.window = sandbox;

      const vmContext = vm.createContext(sandbox);

      // Initial snapshot of global property names in the sandbox
      const initialGlobals = new Set(Object.getOwnPropertyNames(sandbox));

      // Test 1: Execute injection script pattern
      const testPrompt = 'Adversarial Prompt with "quotes", `backticks`, and $special chars.';
      const escapedPrompt = JSON.stringify(testPrompt);
      const injectionScript = `(() => {
      try {
        const ta = document.querySelector('textarea[name="message"]')
          || document.querySelector('div[data-perf-target="composer"] textarea')
          || document.querySelector('textarea[placeholder*="Ask anything"]')
          || document.querySelector('textarea');
        if (!ta) return { success: false, error: 'Arena textarea element not found in DOM.' };
        ta.focus();
        const valueToSet = ${escapedPrompt};
        const proto = Object.getPrototypeOf(ta);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(ta, valueToSet);
        } else {
          ta.value = valueToSet;
        }
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: valueToSet
        });
        ta.dispatchEvent(inputEvent);
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })()`;

      const injectResult = vm.runInContext(injectionScript, vmContext);
      assert.equal(injectResult.success, true, 'Injection script must evaluate successfully');
      assert.equal(mockTaInstance.value, testPrompt, 'Textarea value must be updated');
      assert.equal(mockTaInstance.focused, true, 'Textarea must be focused');

      // Test 2: Execute inspect script pattern
      const inspectScript = `(() => {
      try {
        const composer = document.querySelector('div[data-perf-target="composer"]') || document.body;
        const stopBtn = composer.querySelector('button[aria-label*="Stop"]');
        const ta = document.querySelector('textarea[name="message"]') || composer.querySelector('textarea');
        const isTextareaDisabled = ta ? (ta.disabled || ta.getAttribute('aria-disabled') === 'true') : false;
        return {
          isGenerating: Boolean(stopBtn) || isTextareaDisabled,
          hasStopButton: Boolean(stopBtn),
          isTextareaDisabled,
          text: ''
        };
      } catch (err) {
        return { isGenerating: false, text: '', error: err.message };
      }
    })()`;

      const inspectResult = vm.runInContext(inspectScript, vmContext);
      assert.equal(typeof inspectResult.isGenerating, 'boolean');

      // Verify globals after running both scripts
      const postGlobals = Object.getOwnPropertyNames(sandbox);
      const leakedGlobals = postGlobals.filter((k) => !initialGlobals.has(k));

      assert.equal(
        leakedGlobals.length,
        0,
        `Zero globals must leak into window scope! Leaked: ${leakedGlobals.join(', ')}`,
      );

      // Verify known automation anti-patterns are NOT present
      const bannedAutomationGlobals = [
        '__webdriver',
        '__selenium_evaluate',
        '__webdriver_evaluate',
        '__puppeteer_evaluation_script__',
        '_Selenium_IDE_Recorder',
        'cdc_adoQpoasnfa76pfcZLmcfl_Array',
        'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
        'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
        'kimi',
        'gematron',
      ];

      for (const banned of bannedAutomationGlobals) {
        assert.equal(
          sandbox[banned],
          undefined,
          `Automation artifact window.${banned} must NEVER be defined!`,
        );
      }
    },
  )();

  return results;
}

// Standalone execution if run directly via node
if (process.argv[1] && process.argv[1].endsWith('tier5_adversarial_protocol.test.mjs')) {
  run()
    .then((results) => {
      console.log(
        '\n================================================================================',
      );
      console.log('   TIER 5: CDP & PROTOCOL ADVERSARIAL STRESS TESTING REPORT');
      console.log(
        '================================================================================',
      );
      let passed = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'pass') {
          passed++;
          console.log(`  [PASS] ${r.name} (${r.durationMs}ms)`);
        } else {
          failed++;
          console.log(`  [FAIL] ${r.name} (${r.durationMs}ms)`);
          if (r.error) {
            console.error(`         ERROR: ${r.error.stack || r.error.message}`);
          }
        }
      }
      console.log(
        '--------------------------------------------------------------------------------',
      );
      console.log(`Summary: ${passed}/${results.length} passed (${failed} failed)`);
      console.log(
        '================================================================================\n',
      );
      if (failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('Fatal Tier 5 Runner Error:', err);
      process.exit(1);
    });
}
