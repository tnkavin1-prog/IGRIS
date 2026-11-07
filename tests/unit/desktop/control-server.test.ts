import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from '../../../apps/desktop-hud/src/main/control-server.js';
import type { BrowserWindow } from 'electron';
import type { CDPClient } from '../../../apps/desktop-hud/src/main/cdp-client.js';

describe('ControlServer', () => {
  let server: ControlServer;
  const TEST_PORT = 9228;

  beforeEach(() => {
    server = new ControlServer(TEST_PORT, '127.0.0.1');
  });

  afterEach(() => {
    server.stop();
  });

  it('starts and responds to OPTIONS preflight with CORS headers', async () => {
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

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/summon`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
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

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/summon`, { method: 'POST' });
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
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/summon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown-endpoint`);
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

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/summon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/summon`, { method: 'POST' });
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
      `http://127.0.0.1:${TEST_PORT}/summon?prompt=${encodeURIComponent('Query Param Prompt')}`,
      { method: 'POST' },
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
        `http://127.0.0.1:${TEST_PORT}/summon`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': fullBuffer.length,
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
