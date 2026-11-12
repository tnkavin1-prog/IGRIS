// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONTROL_SERVER_SUMMON_URL,
  ASK_GEMINI_MENU_ID,
  ASK_GEMINI_MENU_TITLE,
  ASK_GEMINI_CONTEXTS,
  formatPageContext,
  extractPageContext,
  extractDomSelection,
  getSelectionFromTab,
  sendSummonRequest,
  setupContextMenu,
  handleAskGemini,
} from '../../../apps/chrome-extension/src/tools/ask-gemini.js';
import { ControlServer } from '../../../apps/desktop-hud/src/main/control-server.js';
import { ControlAuthService } from '../../../apps/desktop-hud/src/main/control-auth.js';
import type { BrowserWindow } from 'electron';
import type { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';

describe('Ask Gemini Tool & Context Extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).chrome;
  });

  describe('formatPageContext', () => {
    it('combines title and url when both are present', () => {
      const result = formatPageContext('Google Search', 'https://www.google.com');
      expect(result).toBe('Google Search\nhttps://www.google.com');
    });

    it('returns only title when url is missing or empty', () => {
      expect(formatPageContext('My Document', '')).toBe('My Document');
      expect(formatPageContext('My Document', null)).toBe('My Document');
    });

    it('returns only url when title is missing or empty', () => {
      expect(formatPageContext('', 'https://example.com')).toBe('https://example.com');
      expect(formatPageContext(null, 'https://example.com')).toBe('https://example.com');
    });

    it('avoids duplicating URL if title is identical to URL', () => {
      expect(formatPageContext('https://example.com', 'https://example.com')).toBe(
        'https://example.com',
      );
      expect(formatPageContext('https://example.com/', 'https://example.com')).toBe(
        'https://example.com',
      );
      expect(formatPageContext('https://example.com', 'https://example.com/')).toBe(
        'https://example.com/',
      );
    });

    it('returns empty string when both title and url are missing', () => {
      expect(formatPageContext('', '')).toBe('');
      expect(formatPageContext(null, null)).toBe('');
    });

    it('trims leading and trailing whitespace', () => {
      expect(formatPageContext('  Trimmed Title  ', '  https://trimmed.url  ')).toBe(
        'Trimmed Title\nhttps://trimmed.url',
      );
    });
  });

  describe('extractPageContext', () => {
    it('uses selected text when text is selected', () => {
      const prompt = extractPageContext({
        selectedText: 'Euler characteristic of a sphere is 2',
        title: 'Topology Notes',
        url: 'https://notes.math.org',
      });
      expect(prompt).toBe('Euler characteristic of a sphere is 2');
    });

    it('falls back to title and url when selection is empty', () => {
      const prompt = extractPageContext({
        selectedText: '',
        title: 'Topology Notes',
        url: 'https://notes.math.org',
      });
      expect(prompt).toBe('Topology Notes\nhttps://notes.math.org');
    });

    it('falls back to title and url when selection is only whitespace', () => {
      const prompt = extractPageContext({
        selectedText: '   \n  \t ',
        title: 'Topology Notes',
        url: 'https://notes.math.org',
      });
      expect(prompt).toBe('Topology Notes\nhttps://notes.math.org');
    });

    it('handles missing selectedText gracefully', () => {
      const prompt = extractPageContext({
        title: 'Topology Notes',
        url: 'https://notes.math.org',
      });
      expect(prompt).toBe('Topology Notes\nhttps://notes.math.org');
    });

    it('handles undefined options argument safely', () => {
      expect(extractPageContext(undefined)).toBe('');
    });
  });

  describe('setupContextMenu', () => {
    it('registers context menu item with Ask Gemini title and complete webpage contexts', () => {
      let registeredItem: chrome.contextMenus.CreateProperties | null = null;
      const createMock = vi.fn((props: chrome.contextMenus.CreateProperties, cb?: () => void) => {
        registeredItem = props;
        if (cb) cb();
      });

      (globalThis as any).chrome = {
        contextMenus: {
          create: createMock,
          update: vi.fn(),
        },
        runtime: {},
      };

      setupContextMenu();

      expect(createMock).toHaveBeenCalled();
      expect(registeredItem).not.toBeNull();
      expect((registeredItem as any)?.id).toBe(ASK_GEMINI_MENU_ID);
      expect((registeredItem as any)?.title).toBe(ASK_GEMINI_MENU_TITLE);
      expect(ASK_GEMINI_CONTEXTS).toContain('all');
      expect(ASK_GEMINI_CONTEXTS).toEqual(
        expect.arrayContaining([
          'all',
          'page',
          'selection',
          'link',
          'editable',
          'image',
          'video',
          'audio',
          'frame',
        ]),
      );
      expect((registeredItem as any)?.contexts).toEqual(ASK_GEMINI_CONTEXTS);
    });

    it('updates context menu item if already created (idempotent)', () => {
      const updateMock = vi.fn();
      const createMock = vi.fn((_props: any, cb?: () => void) => {
        (globalThis as any).chrome.runtime.lastError = {
          message: 'Cannot create item with duplicate id ask-gemini',
        };
        if (cb) cb();
      });

      (globalThis as any).chrome = {
        contextMenus: {
          create: createMock,
          update: updateMock,
        },
        runtime: {},
      };

      setupContextMenu();

      expect(createMock).toHaveBeenCalled();
      expect(updateMock).toHaveBeenCalledWith(
        ASK_GEMINI_MENU_ID,
        expect.objectContaining({
          title: ASK_GEMINI_MENU_TITLE,
          contexts: ASK_GEMINI_CONTEXTS,
        }),
        expect.any(Function),
      );
    });

    it('handles missing or undefined chrome.runtime safely without throwing', () => {
      (globalThis as any).chrome = {
        contextMenus: {
          create: vi.fn((_props: any, cb?: () => void) => {
            if (cb) cb();
          }),
        },
      };

      expect(() => setupContextMenu()).not.toThrow();
    });
  });

  describe('extractDomSelection (direct DOM execution)', () => {
    afterEach(() => {
      document.body.innerHTML = '';
      window.getSelection()?.removeAllRanges();
    });

    it('extracts selection from focused HTMLInputElement', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'Quantum Computing in 2026';
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(8, 17);

      expect(extractDomSelection()).toBe('Computing');
    });

    it('extracts selection from focused HTMLTextAreaElement', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Line 1\nLine 2 Selected\nLine 3';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(7, 22);

      expect(extractDomSelection()).toBe('Line 2 Selected');
    });

    it('handles non-text inputs like number or checkbox without throwing', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      document.body.appendChild(input);
      input.focus();

      expect(() => extractDomSelection()).not.toThrow();
      expect(extractDomSelection()).toBe('');
    });

    it('extracts selection from input element inside open ShadowRoot', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const shadowInput = document.createElement('input');
      shadowInput.value = 'Shadow Root Input Text';
      shadow.appendChild(shadowInput);
      shadowInput.focus();
      shadowInput.setSelectionRange(0, 11);

      expect(extractDomSelection()).toBe('Shadow Root');
    });

    it('extracts non-input text selection from open ShadowRoot when shadow.activeElement is null', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const p = document.createElement('p');
      p.textContent = 'Non-input text in shadow tree';
      shadow.appendChild(p);

      (shadow as any).getSelection = () => ({
        toString: () => 'Non-input text in shadow tree',
      });

      host.focus?.();
      expect(shadow.activeElement).toBeNull();
      expect(extractDomSelection()).toBe('Non-input text in shadow tree');
    });

    it('extracts selection from open ShadowRoot on page when document.activeElement is document.body', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const span = document.createElement('span');
      span.textContent = 'Global shadow root selection';
      shadow.appendChild(span);

      (shadow as any).getSelection = () => ({
        toString: () => 'Global shadow root selection',
      });

      document.body.focus?.();
      expect(extractDomSelection()).toBe('Global shadow root selection');
    });

    it('returns empty string when nothing is selected', () => {
      document.body.innerHTML = '<p>Regular paragraph with no selection</p>';
      expect(extractDomSelection()).toBe('');
    });
  });

  describe('getSelectionFromTab', () => {
    it('prioritizes top frame (frameId: 0) over subframes when multiple frames report selections', async () => {
      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([
            { frameId: 5, result: 'Subframe banner text' },
            { frameId: 0, result: 'Main page selected text' },
          ]),
        },
      };

      const selection = await getSelectionFromTab(200);
      expect(selection).toBe('Main page selected text');
    });
    it('extracts selection via scripting API across all frames', async () => {
      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: '  Selected formula text  ' }]),
        },
      };

      const selection = await getSelectionFromTab(101);
      expect(selection).toBe('Selected formula text');
      expect(globalThis.chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 101, allFrames: true },
        func: expect.any(Function),
      });
    });

    it('falls back to top frame when allFrames execution fails', async () => {
      const executeScript = vi
        .fn()
        .mockRejectedValueOnce(new Error('allFrames restricted on this tab'))
        .mockResolvedValueOnce([{ result: 'Top frame selection' }]);

      (globalThis as any).chrome = {
        scripting: { executeScript },
      };

      const selection = await getSelectionFromTab(103);
      expect(selection).toBe('Top frame selection');
      expect(executeScript).toHaveBeenCalledTimes(2);
      expect(executeScript).toHaveBeenNthCalledWith(1, {
        target: { tabId: 103, allFrames: true },
        func: expect.any(Function),
      });
      expect(executeScript).toHaveBeenNthCalledWith(2, {
        target: { tabId: 103 },
        func: expect.any(Function),
      });
    });

    it('returns empty string if scripting throws on both attempts', async () => {
      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockRejectedValue(new Error('Cannot script chrome:// url')),
        },
      };

      const selection = await getSelectionFromTab(102);
      expect(selection).toBe('');
    });

    it('returns empty string if tabId is missing', async () => {
      const selection = await getSelectionFromTab(undefined);
      expect(selection).toBe('');
    });
  });

  describe('sendSummonRequest', () => {
    it('sends POST request to 9228 endpoint with JSON prompt body', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      const success = await sendSummonRequest('Explain quantum superposition');
      expect(success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        CONTROL_SERVER_SUMMON_URL,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Explain quantum superposition' }),
        }),
      );
    });

    it('returns false when server returns error or is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const success = await sendSummonRequest('Test prompt');
      expect(success).toBe(false);
    });
  });

  describe('handleAskGemini (Toolbar Action & Context Menu entry points)', () => {
    it('includes selected text in payload when text is selected upon toolbar click', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: 'Selected text from user' }]),
        },
      };

      const tab = {
        id: 1,
        title: 'Wikipedia Article',
        url: 'https://en.wikipedia.org/wiki/Mathematics',
      } as chrome.tabs.Tab;

      const result = await handleAskGemini({ tab });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Selected text from user');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Selected text from user' }),
        }),
      );
    });

    it('includes page title and URL in payload when no text is selected upon toolbar click', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: '' }]),
        },
      };

      const tab = {
        id: 2,
        title: 'SSC CGL Mock Exam 2026',
        url: 'https://exam.ssc.gov.in/test/cgl',
      } as chrome.tabs.Tab;

      const result = await handleAskGemini({ tab });

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('SSC CGL Mock Exam 2026');
      expect(result.prompt).toContain('https://exam.ssc.gov.in/test/cgl');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            prompt: 'SSC CGL Mock Exam 2026\nhttps://exam.ssc.gov.in/test/cgl',
          }),
        }),
      );
    });

    it('extracts selection from context menu info when activated from context menu', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      const tab = {
        id: 3,
        title: 'Physics Lab',
        url: 'https://physics.example.edu',
      } as chrome.tabs.Tab;

      const info = {
        menuItemId: ASK_GEMINI_MENU_ID,
        selectionText: 'Wave-particle duality principle',
      } as chrome.contextMenus.OnClickData;

      const result = await handleAskGemini({ tab, info });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Wave-particle duality principle');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Wave-particle duality principle' }),
        }),
      );
    });

    it('falls back to title and URL when right-clicked on webpage with no selection', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: '' }]),
        },
      };

      const tab = {
        id: 4,
        title: 'Chemistry Laboratory',
        url: 'https://chem.example.edu/reactions',
      } as chrome.tabs.Tab;

      const info = {
        menuItemId: ASK_GEMINI_MENU_ID,
      } as chrome.contextMenus.OnClickData;

      const result = await handleAskGemini({ tab, info });

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('Chemistry Laboratory');
      expect(result.prompt).toContain('https://chem.example.edu/reactions');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            prompt: 'Chemistry Laboratory\nhttps://chem.example.edu/reactions',
          }),
        }),
      );
    });

    it('invokes fallbackSummon when ControlServer is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));
      const fallbackSummon = vi.fn().mockResolvedValue(true);

      const tab = {
        id: 5,
        title: 'Fallback Page',
        url: 'https://fallback.example.com',
      } as chrome.tabs.Tab;

      const result = await handleAskGemini({
        tab,
        fallbackSummon,
      });

      expect(result.success).toBe(false);
      expect(fallbackSummon).toHaveBeenCalledWith('Fallback Page\nhttps://fallback.example.com');
    });

    it('falls back to info.pageUrl when tab URL is missing', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      const tab = {
        id: 6,
        title: 'Page With Missing URL In Tab Object',
      } as chrome.tabs.Tab;

      const info = {
        menuItemId: ASK_GEMINI_MENU_ID,
        pageUrl: 'https://actual.page.url/article',
      } as chrome.contextMenus.OnClickData;

      const result = await handleAskGemini({ tab, info });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe(
        'Page With Missing URL In Tab Object\nhttps://actual.page.url/article',
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            prompt: 'Page With Missing URL In Tab Object\nhttps://actual.page.url/article',
          }),
        }),
      );
    });

    it('extracts selection from input element on toolbar click', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: 'Input field query text' }]),
        },
      };

      const tab = {
        id: 7,
        title: 'Form Page',
        url: 'https://form.example.com',
      } as chrome.tabs.Tab;

      const result = await handleAskGemini({ tab });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Input field query text');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Input field query text' }),
        }),
      );
    });

    it('uses pendingUrl when tab.url is not yet available during navigation', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockResolvedValue([{ result: '' }]),
        },
      };

      const tab = {
        id: 8,
        title: '',
        url: '',
        pendingUrl: 'https://navigating.example.com/target',
      } as unknown as chrome.tabs.Tab;

      const result = await handleAskGemini({ tab });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('https://navigating.example.com/target');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'https://navigating.example.com/target' }),
        }),
      );
    });

    it('extracts selection via info.selectionText on restricted pages like PDF viewer without calling executeScript', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      const executeScript = vi.fn().mockRejectedValue(new Error('Cannot script PDF viewer'));
      (globalThis as any).chrome = {
        scripting: { executeScript },
      };

      const tab = {
        id: 9,
        title: 'sample.pdf',
        url: 'file:///E:/docs/sample.pdf',
      } as chrome.tabs.Tab;

      const info = {
        menuItemId: ASK_GEMINI_MENU_ID,
        selectionText: 'Extracted PDF text via browser context menu',
      } as chrome.contextMenus.OnClickData;

      const result = await handleAskGemini({ tab, info });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Extracted PDF text via browser context menu');
      expect(executeScript).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Extracted PDF text via browser context menu' }),
        }),
      );
    });

    it('gracefully falls back to title and URL when toolbar is clicked on restricted pages (e.g. chrome:// or PDF tabs)', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));

      (globalThis as any).chrome = {
        scripting: {
          executeScript: vi.fn().mockRejectedValue(new Error('Cannot access chrome://extensions')),
        },
      };

      const tab = {
        id: 10,
        title: 'Extensions',
        url: 'chrome://extensions/',
      } as chrome.tabs.Tab;

      const result = await handleAskGemini({ tab });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Extensions\nchrome://extensions/');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:9228/summon',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'Extensions\nchrome://extensions/' }),
        }),
      );
    });
  });

  describe('End-to-End ControlServer summon with real HTTP server', () => {
    const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    let server: ControlServer;
    let auth: ControlAuthService;
    const TEST_PORT = 9239;

    beforeEach(() => {
      auth = new ControlAuthService({ tokenGenerator: () => 't'.repeat(64) });
      server = new ControlServer(TEST_PORT, '127.0.0.1', { auth });
    });

    afterEach(() => {
      server.stop();
      vi.unstubAllGlobals();
    });

    it('receives summon request from handleAskGemini and raises/focuses HUD window', async () => {
      const mockWin = {
        isMinimized: vi.fn().mockReturnValue(true),
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        setAlwaysOnTop: vi.fn(),
        webContents: {
          send: vi.fn(),
        },
      } as unknown as BrowserWindow;

      const mockCdp = {
        getActiveTab: vi.fn().mockResolvedValue({ id: 'tab_math', title: 'Calculus III' }),
        getStatus: vi.fn(),
      } as unknown as CDPClient;

      await server.start(() => mockWin, mockCdp);

      // The extension stores the control token via its options page. Scripts
      // cannot forge a chrome-extension:// Origin, and Node fetch does not set
      // one, so the token is the identity proof here.
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({ gematronControlToken: auth.getToken() }),
          },
        },
      };

      // happy-dom enforces browser CORS on cross-origin fetch, but a Chrome
      // extension service worker bypasses it via host permissions. Drive the
      // real server through node:http so the test exercises the same stack.
      vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
        const http = await import('node:http');
        return new Promise((resolve, reject) => {
          const req = http.request(
            url,
            {
              method: init.method ?? 'GET',
              headers: {
                ...(init.headers as Record<string, string>),
                Origin: EXTENSION_ORIGIN,
              },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () =>
                resolve({
                  ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
                  status: res.statusCode,
                  text: async () => body,
                  json: async () => JSON.parse(body),
                } as Response),
              );
            },
          );
          req.on('error', reject);
          if (init.body) req.write(init.body);
          req.end();
        });
      });

      const tab = {
        id: 10,
        title: 'Integral Calculus',
        url: 'https://math.edu/calculus',
      } as chrome.tabs.Tab;

      const info = {
        menuItemId: ASK_GEMINI_MENU_ID,
        selectionText: 'Evaluate the integral of e^(-x^2)',
      } as chrome.contextMenus.OnClickData;

      const result = await handleAskGemini({
        tab,
        info,
        endpoint: `http://127.0.0.1:${TEST_PORT}/summon`,
      });

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('Evaluate the integral of e^(-x^2)');

      expect(mockWin.isMinimized).toHaveBeenCalled();
      expect(mockWin.restore).toHaveBeenCalled();
      expect(mockWin.show).toHaveBeenCalled();
      expect(mockWin.focus).toHaveBeenCalled();
      expect(mockWin.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
      expect(mockWin.webContents.send).toHaveBeenCalledWith('ask-gemini:prompt', {
        prompt: 'Evaluate the integral of e^(-x^2)',
      });
    });
  });

  describe('Extension Manifest Commands Quota', () => {
    it('declares at most 4 commands with suggested_key to satisfy Chrome manifest limits', () => {
      const manifestPath = resolve(__dirname, '../../../apps/chrome-extension/manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

      expect(manifest.commands).toBeDefined();
      expect(manifest.commands._execute_action).toBeDefined();
      expect(manifest.commands._execute_action.suggested_key?.default).toBe('Alt+G');

      const commandsWithSuggestedKey = Object.entries(
        manifest.commands as Record<string, { suggested_key?: unknown }>,
      ).filter(([_, cmd]) => Boolean(cmd?.suggested_key));

      // Chrome MV3 strictly limits 'commands' to at most 4 commands total (kMaxCommandsPerExtension = 4)
      expect(Object.keys(manifest.commands).length).toBeLessThanOrEqual(4);
      expect(commandsWithSuggestedKey.length).toBeLessThanOrEqual(4);
    });
  });
});
