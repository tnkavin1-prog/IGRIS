import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBridgeApp } from '../../../apps/local-bridge/src/app.js';
import type { BridgeConfig } from '../../../apps/local-bridge/src/config.js';
import { silentLogger } from '../../../apps/local-bridge/src/logger.js';
import {
  TokenServiceError,
  type TokenService,
} from '../../../apps/local-bridge/src/token-service.js';
import type { TokenResponse } from '@gbl/shared';

const EXTENSION_ID = 'hhbdkheccnmpbdadhhppbemcjkaimlob';
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const SECRET = 'g'.repeat(43);
const TOKEN_RESPONSE: TokenResponse = {
  token: 'auth_tokens/test-token',
  model: 'gemini-3.8-live',
  newSessionExpiresAt: '2026-11-03T12:01:00.000Z',
  expiresAt: '2026-11-03T12:30:00.000Z',
  singleUse: true,
};

interface RunningBridge {
  port: number;
  close: () => Promise<void>;
}

const running: RunningBridge[] = [];

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function makeConfig(port: number, overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiKey: `AQ.${'k'.repeat(50)}`,
    gateSecret: SECRET,
    port,
    host: '127.0.0.1',
    extensionIds: [EXTENSION_ID],
    extraOrigins: [],
    tokenTtlMs: 1_800_000,
    newSessionTtlMs: 60_000,
    rateLimitPerMinute: 30,
    logLevel: 'silent',
    envFile: 'test',
    allowedModels: ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking'],
    ...overrides,
  };
}

async function start(
  options: {
    config?: Partial<BridgeConfig>;
    mint?: (model: string) => Promise<TokenResponse>;
  } = {},
): Promise<RunningBridge> {
  const port = await freePort();
  const config = makeConfig(port, options.config);
  const tokenService = {
    mint: vi.fn(options.mint ?? (async () => TOKEN_RESPONSE)),
  } as unknown as TokenService;
  const app = createBridgeApp(config, { logger: silentLogger, tokenService });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  const bridge: RunningBridge = {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        app.server.closeAllConnections();
        app.server.close(() => resolve());
      }),
  };
  running.push(bridge);
  return bridge;
}

function url(bridge: RunningBridge, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

afterEach(async () => {
  while (running.length > 0) await running.pop()!.close();
});

describe('bridge HTTP surface', () => {
  it('serves health without an Origin and without leaking secrets', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body).toMatchObject({
      ok: true,
      configured: true,
      keyConfigured: true,
      secretConfigured: true,
      originsConfigured: true,
    });
    expect(body.allowedModels).toContain('gemini-3.8-live');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain('AQ.');
  });

  it('serves non-secret configuration', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/config'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      tokenTtlMs: 1_800_000,
      newSessionTtlMs: 60_000,
      rateLimitPerMinute: 30,
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('adds CORS headers only for an allowed extension origin', async () => {
    const bridge = await start();

    const allowed = await fetch(url(bridge, '/api/health'), { headers: { Origin: ORIGIN } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(allowed.headers.get('vary')).toBe('Origin');

    // Health is intentionally readable by a human, but it must not hand CORS
    // permission to an unlisted origin.
    const unlisted = await fetch(url(bridge, '/api/health'), {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(unlisted.status).toBe(200);
    expect(unlisted.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers CORS preflight for the extension', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/token'), {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('rejects a non-loopback Host header to prevent DNS rebinding', async () => {
    const bridge = await start();

    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: bridge.port,
          path: '/api/health',
          method: 'GET',
          headers: { Host: 'evil.example.com' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on('error', reject);
      request.end();
    });

    expect(status).toBe(403);
  });

  it('requires the bridge secret for token minting', async () => {
    const bridge = await start();

    const missing = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ code: 'unauthorized' });

    const wrong = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-secret',
      },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });
    expect(wrong.status).toBe(401);
  });

  it('rejects token requests from a disallowed origin even with a valid secret', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example.com',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });

    expect(response.status).toBe(403);
  });

  it('mints a token for an authorized request', async () => {
    const mint = vi.fn(async () => TOKEN_RESPONSE);
    const bridge = await start({ mint });

    const response = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TOKEN_RESPONSE);
    expect(mint).toHaveBeenCalledWith('gemini-3.8-live');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('requires a JSON content type', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('rejects malformed JSON and invalid model fields without calling the minter', async () => {
    const mint = vi.fn(async () => TOKEN_RESPONSE);
    const bridge = await start({ mint });

    const malformed = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: '{"model":',
    });
    expect(malformed.status).toBe(400);

    const missingModel = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: '{}',
    });
    expect(missingModel.status).toBe(400);

    expect(mint).not.toHaveBeenCalled();
  });

  it('propagates typed token-service errors with their status and retry window', async () => {
    const bridge = await start({
      mint: async () => {
        throw new TokenServiceError('rate_limited', 'Too many tokens.', 429, 30_000);
      },
    });

    const response = await fetch(url(bridge, '/api/token'), {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ model: 'gemini-3.8-live' }),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 30_000,
    });
  });

  it('rate limits repeated token requests from the same client', async () => {
    const bridge = await start({ config: { rateLimitPerMinute: 1 } });
    const request = () =>
      fetch(url(bridge, '/api/token'), {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SECRET}`,
        },
        body: JSON.stringify({ model: 'gemini-3.8-live' }),
      });

    expect((await request()).status).toBe(200);
    const limited = await request();

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('returns 404 for unknown routes from an allowed origin', async () => {
    const bridge = await start();

    const response = await fetch(url(bridge, '/api/unknown'), { headers: { Origin: ORIGIN } });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found' });
  });
});
