// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BridgeClient, BridgeError } from '../../../apps/chrome-extension/src/live/bridge.js';

describe('BridgeClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes a trailing slash on the base URL', () => {
    const client = new BridgeClient({ baseUrl: 'http://127.0.0.1:8787/', secret: 'x' });
    expect(client.baseUrl).toBe('http://127.0.0.1:8787');
  });

  it('falls back to the default origin when no base URL is given', () => {
    const client = new BridgeClient({ secret: 'x' });
    expect(client.baseUrl).toMatch(/^http:\/\//);
  });

  it('trims the secret', () => {
    const client = new BridgeClient({ secret: '  abc  ' });
    expect(client.hasSecret).toBe(true);
  });

  it('reports hasSecret false for an empty secret', () => {
    const client = new BridgeClient({ secret: '   ' });
    expect(client.hasSecret).toBe(false);
  });

  it('rejects a token response that is not an auth_tokens path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'not-a-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    const client = new BridgeClient({ secret: 'secret' });
    await expect(client.token('gemini-3.8-live')).rejects.toBeInstanceOf(BridgeError);
  });

  it('accepts a well-formed token response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'auth_tokens/abc', expiresAt: Date.now() + 60_000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    const client = new BridgeClient({ secret: 'secret' });
    const result = await client.token('gemini-3.8-live');
    expect(result.token).toBe('auth_tokens/abc');
  });

  it('throws a network error when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as typeof fetch;
    const client = new BridgeClient({ secret: 'secret' });
    await expect(client.health()).rejects.toMatchObject({ code: 'network_error' });
  });

  it('throws a timeout error when the request aborts', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener('abort', () => {
          const err = new DOMException('Aborted', 'AbortError');
          reject(err);
        });
      });
    }) as typeof fetch;
    const client = new BridgeClient({ secret: 'secret' });
    await expect(client.health()).rejects.toMatchObject({ code: 'timeout' });
  });
});
