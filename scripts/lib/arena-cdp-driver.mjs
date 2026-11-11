/**
 * Arena CDP Driver Engine
 * Standalone raw CDP WebSocket client for LMSYS Chatbot Arena (Node 24 native fetch & WebSocket).
 * Zero external npm runtime dependencies ($0 cost).
 *
 * Implements Features 4, 5, 6, 7, 8 matching interface contract in PROJECT.md:
 * - Standalone raw CDP WebSocket client connecting to http://127.0.0.1:9222
 * - Arena tab locator (arena.ai or session ID 01a1c009-84f1-7542-be3f-6d258f0bb652)
 * - React Value Setter Bypass (Object.getOwnPropertyDescriptor + InputEvent/change)
 * - Trusted Enter Submission via CDP Input.dispatchKeyEvent (event.isTrusted: true)
 * - Streaming & Completion Detector (Stop button toggle, disabled textarea, 3s debounce, even code fence parity)
 */

import { EventEmitter } from 'node:events';

/**
 * Interface contract matching PROJECT.md:
 * export class ArenaCDPDriver {
 *   constructor(options = {})
 *   async connect(): Promise<boolean>;
 *   async findArenaTab(): Promise<{ id: string, title: string, url: string, webSocketDebuggerUrl: string } | null>;
 *   async injectPrompt(promptText: string): Promise<{ success: boolean }>;
 *   async submitPrompt(): Promise<{ success: boolean }>;
 *   async waitForCompletion(options?: { pollIntervalMs?: number, debounceMs?: number, timeoutMs?: number }): Promise<{ text: string, durationMs: number }>;
 *   async disconnect(): Promise<void>;
 * }
 */
export class ArenaCDPDriver extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.port=9222] - Chrome remote debugging port
   * @param {string} [options.host='127.0.0.1'] - Chrome remote debugging host
   * @param {string} [options.targetUrl] - Target Arena session URL
   * @param {string} [options.wsUrl] - Direct WebSocket URL override
   */
  constructor(options = {}) {
    super();
    this.port = options.port ?? 9222;
    this.host = options.host ?? '127.0.0.1';
    this.targetUrl = options.targetUrl ?? 'https://arena.ai/c/01a1c009-84f1-7542-be3f-6d258f0bb652';
    this.wsUrl = options.wsUrl ?? null;

    /** @type {{ id: string, title: string, url: string, webSocketDebuggerUrl: string } | null} */
    this.activeTab = null;

    /** @type {WebSocket | null} */
    this.ws = null;
    this.isConnected = false;
    this.messageId = 1;

    /** @type {Map<number, { resolve: (val: any) => void, reject: (err: Error) => void, timeoutId: NodeJS.Timeout }>} */
    this.pendingRequests = new Map();
  }

  /**
   * Base HTTP URL for Chrome remote debugging
   * @returns {string}
   */
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Discovers the Arena tab from Chrome's HTTP endpoint /json
   * @returns {Promise<{ id: string, title: string, url: string, webSocketDebuggerUrl: string } | null>}
   */
  async findArenaTab() {
    const urlsToTry = [`${this.baseUrl}/json`, `${this.baseUrl}/json/list`];

    let tabs = null;
    for (const url of urlsToTry) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          tabs = await res.json();
          break;
        }
      } catch {
        // Continue to fallback endpoint
      }
    }

    if (!Array.isArray(tabs) || tabs.length === 0) {
      return null;
    }

    // Filter to page-type targets (ignore background_page, service_worker, etc.)
    const pages = tabs.filter((t) => !t.type || t.type === 'page');
    if (pages.length === 0) {
      return null;
    }

    // Target identification priorities:
    // 1. Exact match on targetUrl
    // 2. Contains specific session UUID '01a1c009-84f1-7542-be3f-6d258f0bb652'
    // 3. Contains 'arena.ai'
    const targetSessionId = '01a1c009-84f1-7542-be3f-6d258f0bb652';

    let matched = pages.find((t) => t.url && t.url === this.targetUrl);
    if (!matched) {
      matched = pages.find((t) => t.url && t.url.includes(targetSessionId));
    }
    if (!matched) {
      matched = pages.find((t) => t.url && t.url.includes(this.targetUrl));
    }
    if (!matched) {
      matched = pages.find((t) => t.url && t.url.includes('arena.ai'));
    }

    if (!matched) {
      return null;
    }

    // Ensure webSocketDebuggerUrl is properly formatted
    let wsDebuggerUrl = matched.webSocketDebuggerUrl;
    if (!wsDebuggerUrl && matched.id) {
      wsDebuggerUrl = `ws://${this.host}:${this.port}/devtools/page/${matched.id}`;
    }

    this.activeTab = {
      id: String(matched.id || ''),
      title: String(matched.title || ''),
      url: String(matched.url || ''),
      webSocketDebuggerUrl: wsDebuggerUrl,
    };

    return this.activeTab;
  }

  /**
   * Establishes a raw CDP WebSocket connection to the discovered Arena tab
   * @param {number} [timeoutMs=8000] - Connection timeout
   * @returns {Promise<boolean>}
   */
  async connect(timeoutMs = 8000) {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return true;
    }

    // Discover tab if not provided or overridden
    if (!this.activeTab && !this.wsUrl) {
      const tab = await this.findArenaTab();
      if (!tab) {
        return false;
      }
    }

    const targetWsUrl = this.wsUrl || this.activeTab?.webSocketDebuggerUrl;
    if (!targetWsUrl) {
      return false;
    }

    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.cleanupSocket();
          resolve(false);
        }
      }, timeoutMs);

      try {
        const socket = new WebSocket(targetWsUrl);
        this.ws = socket;

        socket.onopen = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.isConnected = true;
            this.emit('connected', this.activeTab);
            resolve(true);
          }
        };

        socket.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };

        socket.onerror = (err) => {
          this.emit('error', err);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this.cleanupSocket();
            resolve(false);
          }
        };

        socket.onclose = (event) => {
          this.isConnected = false;
          this.emit('close', event);
          this.rejectAllPending(new Error(`CDP WebSocket closed (code ${event.code})`));
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(false);
          }
        };
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.cleanupSocket();
          resolve(false);
        }
      }
    });
  }

  /**
   * Sends a raw CDP JSON-RPC command over WebSocket
   * @template T
   * @param {string} method - CDP domain method (e.g. 'Runtime.evaluate', 'Input.dispatchKeyEvent')
   * @param {Record<string, any>} [params={}] - Command parameters
   * @param {number} [timeoutMs=20000] - Request timeout
   * @returns {Promise<T>}
   */
  async sendCDPCommand(method, params = {}, timeoutMs = 20000) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send CDP command '${method}': WebSocket is not connected.`);
    }

    const id = this.messageId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`CDP command '${method}' timed out after ${timeoutMs}ms (id: ${id}).`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      try {
        this.ws.send(payload);
      } catch (sendErr) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(sendErr);
      }
    });
  }

  /**
   * Evaluates an expression inside the page runtime
   * @template T
   * @param {string} expression - JavaScript code to evaluate
   * @param {object} [options]
   * @param {boolean} [options.returnByValue=true]
   * @param {boolean} [options.awaitPromise=true]
   * @param {boolean} [options.userGesture=true]
   * @param {number} [options.timeoutMs=15000]
   * @returns {Promise<T>}
   */
  async evaluate(expression, options = {}) {
    const res = await this.sendCDPCommand(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: options.returnByValue ?? true,
        awaitPromise: options.awaitPromise ?? true,
        userGesture: options.userGesture ?? true,
      },
      options.timeoutMs ?? 15000,
    );

    if (res?.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description ||
        res.exceptionDetails.text ||
        'Unknown runtime exception';
      throw new Error(`Runtime.evaluate exception: ${desc}`);
    }

    return res?.result?.value;
  }

  /**
   * Injects prompt text into Arena's chat textarea bypassing React's internal value tracker
   * Evaluates:
   * Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, promptText)
   * Followed by InputEvent ('insertText') and change event.
   *
   * @param {string} promptText - The prompt string to inject
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async injectPrompt(promptText) {
    if (!this.isConnected) {
      throw new Error('ArenaCDPDriver is not connected. Call connect() first.');
    }

    const escapedPrompt = JSON.stringify(promptText);

    const injectionScript = `(() => {
      try {
        // Discover Arena chat textarea across primary and fallback selectors
        const ta = document.querySelector('textarea[name="message"]')
          || document.querySelector('div[data-perf-target="composer"] textarea')
          || document.querySelector('textarea[placeholder*="Ask anything"]')
          || document.querySelector('textarea');

        if (!ta) {
          return { success: false, error: 'Arena textarea element not found in DOM.' };
        }

        ta.focus();
        const valueToSet = ${escapedPrompt};

        // React Prototype Value Setter Bypass:
        // React overrides the 'value' property on input/textarea elements with its own setter
        // that checks _valueTracker. Calling the native HTMLTextAreaElement prototype setter
        // bypasses the interceptor and updates the DOM property directly.
        const proto = Object.getPrototypeOf(ta);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

        if (descriptor && descriptor.set) {
          descriptor.set.call(ta, valueToSet);
        } else {
          ta.value = valueToSet;
        }

        // Dispatch synthetic InputEvent with inputType='insertText'
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: valueToSet
        });
        ta.dispatchEvent(inputEvent);

        // Dispatch standard change event
        ta.dispatchEvent(new Event('change', { bubbles: true }));

        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    })()`;

    try {
      const result = await this.evaluate(injectionScript);
      if (result && result.success) {
        return { success: true };
      }
      return { success: false, error: result?.error || 'Injection failed' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches authentic Enter submission via CDP Input.dispatchKeyEvent.
   * This generates OS-level key events with isTrusted: true, satisfying
   * Arena's anti-bot markEnterTrigger integrity checks.
   *
   * @returns {Promise<{ success: boolean }>}
   */
  async submitPrompt() {
    if (!this.isConnected) {
      throw new Error('ArenaCDPDriver is not connected. Call connect() first.');
    }

    // Step 1: rawKeyDown for Enter (virtual code 13)
    await this.sendCDPCommand('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 13,
      unmodifiedText: '\r',
      text: '\r',
      key: 'Enter',
      code: 'Enter',
    });

    // Step 2: keyUp for Enter
    await this.sendCDPCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 13,
      unmodifiedText: '\r',
      text: '\r',
      key: 'Enter',
      code: 'Enter',
    });

    return { success: true };
  }

  /**
   * 3-Tier Streaming & Completion Detector
   * Tier 1: Stop button presence/disappearance & textarea re-enable
   * Tier 2: Content text length stability debounce (default 3s)
   * Tier 3: Parity of markdown code fence delimiters (``` count must be even)
   *
   * @param {object} [options]
   * @param {number} [options.pollIntervalMs=1000] - Polling interval in ms
   * @param {number} [options.debounceMs=3000] - Required text stability duration in ms
   * @param {number} [options.timeoutMs=300000] - Total generation timeout in ms (default 5 min)
   * @param {(chunk: string) => void} [options.onChunk] - Progress callback
   * @returns {Promise<{ text: string, durationMs: number }>}
   */
  async waitForCompletion(options = {}) {
    if (!this.isConnected) {
      throw new Error('ArenaCDPDriver is not connected. Call connect() first.');
    }

    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const debounceMs = options.debounceMs ?? 3000;
    const timeoutMs = options.timeoutMs ?? 300000;
    const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;

    const startTime = Date.now();
    let lastSeenText = '';
    let stableSince = null;
    let hasStartedGenerating = false;

    // Inspection script evaluated inside page context
    const inspectScript = `(() => {
      try {
        const composer = document.querySelector('div[data-perf-target="composer"]') || document.body;
        
        // Stop button checks
        const stopBtn = composer.querySelector('button[aria-label*="Stop"]')
          || composer.querySelector('button[aria-label*="stop"]')
          || composer.querySelector('button:has(svg rect)')
          || composer.querySelector('button[data-perf-target="stop"]')
          || document.querySelector('button[aria-label*="Stop"]');
        
        // Textarea disabled check
        const ta = document.querySelector('textarea[name="message"]')
          || composer.querySelector('textarea');
        const isTextareaDisabled = ta ? (ta.disabled || ta.getAttribute('aria-disabled') === 'true') : false;

        // Assistant response content extraction
        const assistantSelectors = [
          'div[data-perf-target="message-assistant"]',
          'div[data-message-role="assistant"]',
          'div[data-role="assistant"]',
          '.prose',
          'div[class*="prose"]',
          'div[class*="model-response"]',
          'div[class*="markdown"]'
        ];

        let extractedText = '';
        for (const sel of assistantSelectors) {
          const nodes = document.querySelectorAll(sel);
          if (nodes && nodes.length > 0) {
            const last = nodes[nodes.length - 1];
            const txt = (last.innerText || last.textContent || '').trim();
            if (txt.length > extractedText.length) {
              extractedText = txt;
            }
          }
        }

        // Fallback: search messages in chat area
        if (!extractedText) {
          const chatArea = document.querySelector('#chat-area') || document.querySelector('main');
          if (chatArea) {
            const bubbles = chatArea.querySelectorAll('div[class*="message"], div[class*="bubble"]');
            if (bubbles.length > 0) {
              extractedText = (bubbles[bubbles.length - 1].innerText || '').trim();
            }
          }
        }

        const isActivelyGenerating = Boolean(stopBtn) || isTextareaDisabled;

        return {
          isGenerating: isActivelyGenerating,
          hasStopButton: Boolean(stopBtn),
          isTextareaDisabled,
          text: extractedText
        };
      } catch (err) {
        return { isGenerating: false, text: '', error: err.message };
      }
    })()`;

    while (Date.now() - startTime < timeoutMs) {
      let state;
      try {
        state = await this.evaluate(inspectScript, { timeoutMs: 8000 });
      } catch {
        // Transient evaluation error, wait and retry
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      const currentText = (state?.text || '').trim();

      // Emit chunk callback if text grew
      if (currentText.length > lastSeenText.length) {
        if (onChunk) onChunk(currentText);
        this.emit('chunk', currentText);
      }

      // Mark that generation has begun
      if (state?.isGenerating || currentText.length > 0) {
        hasStartedGenerating = true;
      }

      // Tier 1: UI State Check
      // Actively generating if Stop button present or textarea disabled
      const uiIndicatesDone = !state?.isGenerating;

      // Tier 2: Stability Debounce Check
      if (currentText.length > 0 && currentText === lastSeenText) {
        if (stableSince === null) {
          stableSince = Date.now();
        }
      } else {
        stableSince = null;
        lastSeenText = currentText;
      }

      const debounceMet = Boolean(stableSince && Date.now() - stableSince >= debounceMs);

      // Tier 3: Markdown Code Fence Parity Check
      // Count triple backtick occurrences (```)
      const fenceMatches = currentText.match(/```/g) || [];
      const isFenceParityEven = fenceMatches.length % 2 === 0;

      // Completion requires:
      // 1. Generation has started and text is non-empty
      // 2. UI indicates completion (Stop button absent, textarea re-enabled)
      // 3. Text content has been stable for at least debounceMs
      // 4. Code fence parity is even (no open unterminated code blocks)
      if (
        hasStartedGenerating &&
        currentText.length > 0 &&
        uiIndicatesDone &&
        debounceMet &&
        isFenceParityEven
      ) {
        return {
          text: currentText,
          durationMs: Date.now() - startTime,
        };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `waitForCompletion timed out after ${timeoutMs}ms (last captured text length: ${lastSeenText.length}).`,
    );
  }

  /**
   * Gracefully disconnects the WebSocket and cleans up resources
   * @returns {Promise<void>}
   */
  async disconnect() {
    this.cleanupSocket();
    this.activeTab = null;
    this.isConnected = false;
  }

  /**
   * Internal helper to clean up socket connection and pending requests
   */
  cleanupSocket() {
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.rejectAllPending(new Error('ArenaCDPDriver disconnected.'));
  }

  /**
   * Internal message dispatcher for raw CDP incoming JSON frames
   * @param {any} rawData
   */
  handleIncomingMessage(rawData) {
    try {
      const dataStr = typeof rawData === 'string' ? rawData : rawData.toString();
      const msg = JSON.parse(dataStr);

      if (typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
        const { resolve, reject, timeoutId } = this.pendingRequests.get(msg.id);
        clearTimeout(timeoutId);
        this.pendingRequests.delete(msg.id);

        if (msg.error) {
          reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method) {
        // CDP event (e.g. Page.loadEventFired, Runtime.consoleAPICalled)
        this.emit(msg.method, msg.params);
      }
    } catch {
      // Ignore unparseable frames
    }
  }

  /**
   * Rejects and clears all outstanding CDP request promises
   * @param {Error} error
   */
  rejectAllPending(error) {
    for (const req of this.pendingRequests.values()) {
      clearTimeout(req.timeoutId);
      req.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Utility helper to check if code fence count in text is even
   * @param {string} text
   * @returns {boolean}
   */
  static isCodeFenceParityEven(text) {
    const fences = (String(text || '').match(/```/g) || []).length;
    return fences % 2 === 0;
  }
}
