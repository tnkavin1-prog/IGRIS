/**
 * Mock Chrome DevTools Protocol (CDP) Server for E2E Tests
 * Simulates Chrome port 9222 HTTP endpoints (/json, /json/version)
 * and WebSocket debugging session for LMSYS Chatbot Arena.
 */

import http from 'node:http';
import vm from 'node:vm';
import { WebSocketServer } from 'ws';

export class MockCDPServer {
  constructor(options = {}) {
    this.port = options.port ?? 9222;
    this.host = options.host ?? '127.0.0.1';
    this.targetId = options.targetId ?? 'MOCK-ARENA-TAB-01a1c009';
    this.targetUrl = options.targetUrl ?? 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652';
    this.targetTitle = options.targetTitle ?? 'LMSYS Chatbot Arena - Kimi K3';

    this.httpServer = null;
    this.wss = null;
    this.activeWsClient = null;
    this.receivedCalls = [];

    // DOM & Chat simulation state
    this.domState = {
      textareaValue: '',
      textareaDisabled: false,
      sendButtonDisabled: true,
      stopButtonVisible: false,
      isGenerating: false,
      lastAssistantText: '',
      injectedPrompts: [],
    };

    // Pre-configured scenarios
    this.currentScenario = 'standard-refactor';
    this.scenarioConfig = {
      streamDelayMs: options.streamDelayMs ?? 20,
      customResponse: null,
    };

    this._setupDefaultScenarioResponse();
  }

  _setupDefaultScenarioResponse() {
    this.scenarioResponses = {
      'standard-refactor': [
        'I will refactor the target module as requested.\n\n',
        '```typescript\n',
        '// FILE: packages/shared/src/utils/calculator.ts\n',
        'export function add(a: number, b: number): number {\n',
        '  return a + b;\n',
        '}\n\n',
        'export function multiply(a: number, b: number): number {\n',
        '  return a * b;\n',
        '}\n',
        '```\n\n',
        'Refactoring complete with all exported helpers.',
      ].join(''),

      'multi-file': [
        'Applying multi-file refactor and file removal.\n\n',
        '```typescript\n',
        '// FILE: packages/shared/src/utils/math.ts\n',
        'export const PI = 3.14159265359;\n',
        'export function square(x: number): number { return x * x; }\n',
        '```\n\n',
        '```json\n',
        '// FILE: packages/shared/config.json\n',
        '{\n',
        '  "version": "2.0.0",\n',
        '  "enabled": true\n',
        '}\n',
        '```\n\n',
        '```typescript\n',
        '// DELETE_FILE: packages/shared/src/deprecated-old.ts\n',
        '```\n\n',
        'Changes batched successfully.',
      ].join(''),

      'unclosed-fence': [
        'Here is the code block:\n\n',
        '```typescript\n',
        '// FILE: packages/shared/src/broken.ts\n',
        'export function incomplete() {\n',
        "  console.log('truncation occurred mid-generation');\n",
        // Intentionally missing closing backticks
      ].join(''),

      'path-traversal-attack': [
        'Here is the system update:\n\n',
        '```typescript\n',
        '// FILE: ../../malicious-escape.bat\n',
        'echo Vulnerability exploited\n',
        '```\n\n',
        '```typescript\n',
        '// FILE: .git/hooks/pre-commit\n',
        '#!/bin/sh\nexit 1\n',
        '```\n',
      ].join(''),

      'syntax-error': [
        'Updating file with syntax violation:\n\n',
        '```typescript\n',
        '// FILE: packages/shared/src/syntax-fail.ts\n',
        'const broken = ((\n', // Unclosed parenthesis
        '```\n',
      ].join(''),
    };
  }

  setScenario(name, config = {}) {
    this.currentScenario = name;
    if (config.customResponse) {
      this.scenarioConfig.customResponse = config.customResponse;
    }
    if (typeof config.streamDelayMs === 'number') {
      this.scenarioConfig.streamDelayMs = config.streamDelayMs;
    }
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => this._handleHttp(req, res));
      this.wss = new WebSocketServer({ noServer: true });

      this.httpServer.on('upgrade', (req, socket, head) => {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      });

      this.wss.on('connection', (ws, req) => {
        this.activeWsClient = ws;
        ws.on('message', (data) => this._handleWsMessage(ws, data));
        ws.on('close', () => {
          if (this.activeWsClient === ws) {
            this.activeWsClient = null;
          }
        });
      });

      this.httpServer.on('error', reject);
      this.httpServer.listen(this.port, this.host, () => {
        resolve({
          port: this.port,
          host: this.host,
          targetUrl: this.targetUrl,
          wsUrl: `ws://${this.host}:${this.port}/devtools/page/${this.targetId}`,
        });
      });
    });
  }

  async stop() {
    if (this.activeWsClient) {
      try {
        this.activeWsClient.terminate();
      } catch {}
      this.activeWsClient = null;
    }
    if (this.wss) {
      await new Promise((res) => this.wss.close(res));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise((res) => this.httpServer.close(res));
      this.httpServer = null;
    }
  }

  _handleHttp(req, res) {
    const url = new URL(req.url, `http://${this.host}:${this.port}`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/json/version') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          Browser: 'Chrome/133.0.6943.54 (Mock)',
          'Protocol-Version': '1.3',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/133.0.0.0 Safari/537.36 Mock',
          'V8-Version': '13.3.1',
          'WebKit-Version': '537.36',
          webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/browser/mock-browser-id`,
        }),
      );
      return;
    }

    if (url.pathname === '/json' || url.pathname === '/json/list') {
      res.writeHead(200);
      res.end(
        JSON.stringify([
          {
            id: this.targetId,
            title: this.targetTitle,
            type: 'page',
            url: this.targetUrl,
            devtoolsFrontendUrl: `/devtools/inspector.html?ws=${this.host}:${this.port}/devtools/page/${this.targetId}`,
            webSocketDebuggerUrl: `ws://${this.host}:${this.port}/devtools/page/${this.targetId}`,
          },
        ]),
      );
      return;
    }

    if (url.pathname.startsWith('/json/activate/')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Target activated');
      return;
    }

    if (url.pathname.startsWith('/json/close/')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Target closed');
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  _handleWsMessage(ws, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    this.receivedCalls.push(message);
    const { id, method, params = {} } = message;

    if (
      method === 'Page.enable' ||
      method === 'DOM.enable' ||
      method === 'Runtime.enable' ||
      method === 'Input.setIgnoreInputEvents'
    ) {
      ws.send(JSON.stringify({ id, result: {} }));
      return;
    }

    if (method === 'Runtime.evaluate') {
      const result = this._evalExpression(params.expression ?? '');
      ws.send(JSON.stringify({ id, result }));
      return;
    }

    if (method === 'Input.dispatchKeyEvent') {
      // Enter submission detection
      const isEnter =
        params.key === 'Enter' || params.windowsVirtualKeyCode === 13 || params.code === 'Enter';
      if (isEnter && (params.type === 'rawKeyDown' || params.type === 'keyDown')) {
        this._triggerAssistantGeneration();
      }
      ws.send(JSON.stringify({ id, result: {} }));
      return;
    }

    // Default response for other CDP commands
    ws.send(JSON.stringify({ id, result: {} }));
  }

  _evalExpression(expr) {
    // 1. Value injection check (React prototype descriptor setter)
    if (
      expr.includes('Object.getOwnPropertyDescriptor') ||
      expr.includes('HTMLTextAreaElement.prototype') ||
      expr.includes('.value =')
    ) {
      // Extract prompt value if possible
      const match = expr.match(/(?:call\(ta,\s*|ta\.value\s*=\s*)(["'`])([\s\S]*?)\1/);
      if (match) {
        this.domState.textareaValue = match[2];
      } else {
        this.domState.textareaValue = 'Simulated prompt payload';
      }
      this.domState.injectedPrompts.push(this.domState.textareaValue);
      this.domState.sendButtonDisabled = false;
      return { result: { type: 'object', value: { success: true } } };
    }

    // 2. Inspection script in waitForCompletion
    if (
      expr.includes('isActivelyGenerating') ||
      (expr.includes('hasStopButton') && expr.includes('isGenerating'))
    ) {
      return {
        result: {
          type: 'object',
          value: {
            isGenerating: this.domState.isGenerating,
            hasStopButton: this.domState.stopButtonVisible,
            isTextareaDisabled: this.domState.textareaDisabled,
            text: this.domState.lastAssistantText,
          },
        },
      };
    }

    // 3. Stop Button presence check
    if (
      expr.includes('button[aria-label*="Stop"]') ||
      expr.includes('button:has(svg rect)') ||
      expr.includes('canStop') ||
      expr.includes('stopGeneration')
    ) {
      if (this.domState.stopButtonVisible) {
        return { result: { type: 'object', value: { hasStop: true, ariaLabel: 'Stop message' } } };
      }
      return { result: { type: 'object', value: null } };
    }

    // 4. Textarea disabled state check
    if (
      expr.includes('textarea[name="message"][disabled]') ||
      expr.includes('textarea:disabled') ||
      expr.includes('isSubmitting')
    ) {
      return { result: { type: 'boolean', value: this.domState.textareaDisabled } };
    }

    // 5. Send button state check
    if (expr.includes('data-perf-target="send"') || expr.includes('button[type="submit"]')) {
      return {
        result: {
          type: 'object',
          value: {
            disabled: this.domState.sendButtonDisabled,
            visible: true,
          },
        },
      };
    }

    // 6. Assistant response text extraction
    if (
      expr.includes('#chat-area') ||
      expr.includes('markdown') ||
      expr.includes('lastElementChild') ||
      expr.includes('assistant') ||
      expr.includes('pre') ||
      expr.includes('code')
    ) {
      return {
        result: {
          type: 'string',
          value: this.domState.lastAssistantText,
        },
      };
    }

    // Fallback: evaluate using lightweight DOM mock in VM context
    try {
      const sandbox = {
        document: {
          querySelector: (sel) => {
            if (sel.includes('textarea')) {
              return {
                value: this.domState.textareaValue,
                disabled: this.domState.textareaDisabled,
                focus: () => {},
                dispatchEvent: () => true,
              };
            }
            if (sel.includes('Stop') || sel.includes('rect')) {
              return this.domState.stopButtonVisible ? { ariaLabel: 'Stop message' } : null;
            }
            if (sel.includes('send') || sel.includes('submit')) {
              return {
                disabled: this.domState.sendButtonDisabled,
                click: () => this._triggerAssistantGeneration(),
              };
            }
            return null;
          },
          querySelectorAll: () => [],
        },
        window: {
          location: { href: this.targetUrl },
        },
        Event: class {
          constructor(type) {
            this.type = type;
          }
        },
        InputEvent: class {
          constructor(type, init) {
            this.type = type;
            this.data = init?.data;
          }
        },
        HTMLTextAreaElement: class {},
      };
      const context = vm.createContext(sandbox);
      const val = vm.runInContext(expr, context);
      return { result: { type: typeof val, value: val } };
    } catch {
      return { result: { type: 'undefined' } };
    }
  }

  _triggerAssistantGeneration() {
    this.domState.isGenerating = true;
    this.domState.stopButtonVisible = true;
    this.domState.textareaDisabled = true;
    this.domState.sendButtonDisabled = true;

    const response =
      this.scenarioConfig.customResponse ??
      this.scenarioResponses[this.currentScenario] ??
      this.scenarioResponses['standard-refactor'];

    // Simulate progressive generation
    const delay = this.scenarioConfig.streamDelayMs;
    setTimeout(() => {
      this.domState.lastAssistantText = response;
      this.domState.stopButtonVisible = false;
      this.domState.textareaDisabled = false;
      this.domState.sendButtonDisabled = false;
      this.domState.isGenerating = false;
    }, delay);
  }
}

// Standalone CLI execution if run directly
if (process.argv[1] && process.argv[1].endsWith('mock-cdp-server.mjs')) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? parseInt(process.argv[portArg + 1], 10) : 9222;
  const server = new MockCDPServer({ port });
  server
    .start()
    .then((info) => {
      console.log(`[MockCDPServer] Running on port ${info.port}`);
      console.log(`[MockCDPServer] Target URL: ${info.targetUrl}`);
      console.log(`[MockCDPServer] WebSocket: ${info.wsUrl}`);
    })
    .catch((err) => {
      console.error(`[MockCDPServer] Error:`, err);
      process.exit(1);
    });
}
