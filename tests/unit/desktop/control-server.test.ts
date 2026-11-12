import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from '../../../apps/desktop-hud/src/main/control-server.js';
import { ControlAuthService } from '../../../apps/desktop-hud/src/main/control-auth.js';
import type { BrowserWindow } from 'electron';
import type { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';

const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('ControlServer', () => {
  let server: ControlServer;
  let auth: ControlAuthService;
  let token: string;
  const TEST_PORT = 0;

  beforeEach(() => {
    auth = new ControlAuthService({ tokenGenerator: () => 't'.repeat(64) });
    token = auth.getToken();
    server = new ControlServer(TEST_PORT, '127.0.0.1', { auth });
  });

  afterEach(() => {
    server.stop();
  });

  /** Native-caller fetch helper: attaches the control token. */

  it('starts and responds to OPTIONS preflight reflecting only allowed origins', async () => {
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue({ id: 'tab1', title: 'Test Tab' }),
      getStatus: vi.fn(),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const ext = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'OPTIONS',
      headers: { Origin: EXTENSION_ORIGIN, Host: `127.0.0.1:${server.port}` },
    });
    expect(ext.status).toBe(204);
    expect(ext.headers.get('Access-Control-Allow-Origin')).toBe(EXTENSION_ORIGIN);

    const native = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'OPTIONS',
      headers: { Host: `127.0.0.1:${server.port}` },
    });
    expect(native.headers.get('Access-Control-Allow-Origin')).toBe('null');
  });

  it('rejects web origins outright regardless of token', async () => {
    const mockCdp = {} as unknown as CDPClient;
    await server.start(() => null, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'X-Gematron-Control-Token': token,
        Host: `127.0.0.1:${server.port}`,
      },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it('rejects non-loopback Host headers (DNS rebinding)', async () => {
    const mockCdp = {} as unknown as CDPClient;
    await server.start(() => null, mockCdp);

    // Node fetch pins the real host; use raw http to forge the Host header.
    const http = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${server.port}/summon`,
        { method: 'POST', headers: { Host: 'evil.example:9228' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('requires a token for /summon from native (no-origin) callers', async () => {
    const mockCdp = {} as unknown as CDPClient;
    await server.start(() => null, mockCdp);

    const noToken = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: { Host: `127.0.0.1:${server.port}` },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: {
        'X-Gematron-Control-Token': 'w'.repeat(64),
        Host: `127.0.0.1:${server.port}`,
      },
      body: JSON.stringify({ prompt: 'x' }),
    });
    expect(badToken.status).toBe(401);
  });

  it('allows extension-origin /summon without a token (first-party allowlist)', async () => {
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;
    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn(),
    } as unknown as CDPClient;
    await server.start(() => mockWin, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: { Origin: EXTENSION_ORIGIN, Host: `127.0.0.1:${server.port}` },
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(200);
  });

  it('keeps read-only GET /status open to native callers without a token', async () => {
    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn().mockResolvedValue({ connected: true }),
    } as unknown as CDPClient;
    await server.start(() => null, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/status`, {
      headers: { Host: `127.0.0.1:${server.port}` },
    });
    expect(res.status).toBe(200);
  });

  it('reports a failed bind instead of pretending the control API is up', async () => {
    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn(),
    } as unknown as CDPClient;

    const first = new ControlServer(0, '127.0.0.1', { auth });
    const bound = await first.start(() => null, mockCdp);
    expect(bound).toBe(true);

    // A second server on the same port cannot bind and must say so.
    const second = new ControlServer(first.port, '127.0.0.1', { auth });
    const secondBound = await second.start(() => null, mockCdp);
    expect(secondBound).toBe(false);

    second.stop();
    first.stop();
  });

  it('un-minimizes, raises, focuses window and returns active tab on POST /summon', async () => {
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue({ id: 'pdf_tab', title: 'Compiled pyq.pdf' }),
      getStatus: vi.fn(),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: { 'X-Gematron-Control-Token': token, Host: `127.0.0.1:${server.port}` },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean; activeTab: { id: string; title: string } };
    expect(body.ok).toBe(true);
    expect(body.activeTab.title).toBe('Compiled pyq.pdf');

    expect(mockWin.isMinimized).toHaveBeenCalled();
    expect(mockWin.restore).toHaveBeenCalled();
    expect(mockWin.show).toHaveBeenCalled();
    expect(mockWin.focus).toHaveBeenCalled();
    expect(mockWin.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('defaults port to 9228', () => {
    const defaultServer = new ControlServer();
    expect(defaultServer.port).toBe(9228);
    expect(defaultServer.host).toBe('127.0.0.1');
  });

  it('receives prompt payload on POST /summon and raises HUD window without errors', async () => {
    const mockSend = vi.fn();
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      webContents: {
        send: mockSend,
      },
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue({ id: 'active_1', title: 'Active Page' }),
      getStatus: vi.fn(),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const promptText = 'Explain this selected paragraph in detail';
    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gematron-Control-Token': token,
        Host: `127.0.0.1:${server.port}`,
      },
      body: JSON.stringify({ prompt: promptText }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      prompt: string;
      activeTab: { id: string; title: string };
    };
    expect(body.ok).toBe(true);
    expect(body.prompt).toBe(promptText);
    expect(mockWin.show).toHaveBeenCalled();
    expect(mockWin.focus).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith('ask-gemini:prompt', { prompt: promptText });
  });

  it('returns 404 for unknown routes', async () => {
    const mockWin = null;
    const mockCdp = {} as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/unknown-endpoint`);
    expect(res.status).toBe(404);
  });

  it('handles CDP connection failures gracefully during /summon without crashing', async () => {
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
    } as unknown as BrowserWindow;

    // Simulate CDP being offline or throwing
    const mockCdp = {
      getActiveTab: vi.fn().mockRejectedValue(new Error('CDP connection refused')),
      getStatus: vi.fn(),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gematron-Control-Token': token,
        Host: `127.0.0.1:${server.port}`,
      },
      body: JSON.stringify({ prompt: 'Test during CDP outage' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; activeTab: null; prompt: string };
    expect(body.ok).toBe(true);
    expect(body.activeTab).toBeNull();
    expect(body.prompt).toBe('Test during CDP outage');
    expect(mockWin.show).toHaveBeenCalled();
    expect(mockWin.focus).toHaveBeenCalled();
  });

  it('safely skips window actions when window is destroyed', async () => {
    const mockWin = {
      isDestroyed: vi.fn().mockReturnValue(true),
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const res = await fetch(`http://127.0.0.1:${server.port}/summon`, {
      method: 'POST',
      headers: { 'X-Gematron-Control-Token': token, Host: `127.0.0.1:${server.port}` },
    });
    expect(res.status).toBe(200);
    expect(mockWin.show).not.toHaveBeenCalled();
    expect(mockWin.focus).not.toHaveBeenCalled();
  });

  it('accepts prompt from query parameters when body is omitted', async () => {
    const mockSend = vi.fn();
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const res = await fetch(
      `http://127.0.0.1:${server.port}/summon?prompt=${encodeURIComponent('Query Param Prompt')}`,
      {
        method: 'POST',
        headers: { 'X-Gematron-Control-Token': token, Host: `127.0.0.1:${server.port}` },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; prompt: string };
    expect(body.ok).toBe(true);
    expect(body.prompt).toBe('Query Param Prompt');
    expect(mockSend).toHaveBeenCalledWith('ask-gemini:prompt', { prompt: 'Query Param Prompt' });
  });

  it('correctly decodes multi-byte UTF-8 prompts split across buffer chunks without corruption', async () => {
    const mockSend = vi.fn();
    const mockWin = {
      isMinimized: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      webContents: { send: mockSend },
    } as unknown as BrowserWindow;

    const mockCdp = {
      getActiveTab: vi.fn().mockResolvedValue(null),
    } as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);

    const fullPayload = JSON.stringify({ prompt: 'Ask Gemini: 💡 🧠 ∇ Quantum Analysis' });
    const fullBuffer = Buffer.from(fullPayload, 'utf-8');

    // Split right in the middle of the 💡 emoji (which is 4 bytes in UTF-8: f0 9f 92 a1)
    const splitIndex = fullBuffer.indexOf(Buffer.from([0xf0, 0x9f, 0x92, 0xa1])) + 2;
    const chunk1 = fullBuffer.subarray(0, splitIndex);
    const chunk2 = fullBuffer.subarray(splitIndex);

    const http = await import('node:http');
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://127.0.0.1:${server.port}/summon`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': fullBuffer.length,
            'X-Gematron-Control-Token': token,
            Host: `127.0.0.1:${server.port}`,
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        },
      );
      req.on('error', reject);
      req.write(chunk1);
      setTimeout(() => {
        req.write(chunk2);
        req.end();
      }, 10);
    });

    expect(mockSend).toHaveBeenCalledWith('ask-gemini:prompt', {
      prompt: 'Ask Gemini: 💡 🧠 ∇ Quantum Analysis',
    });
  });

  it('stops server cleanly and safely handles subsequent stop calls', async () => {
    const mockWin = null;
    const mockCdp = {} as unknown as CDPClient;

    await server.start(() => mockWin, mockCdp);
    expect(() => server.stop()).not.toThrow();
    // Idempotent stop
    expect(() => server.stop()).not.toThrow();
  });
});
