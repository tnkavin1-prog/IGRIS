import { describe, expect, it, vi } from 'vitest';
import type { BridgeConfig } from '../../../apps/local-bridge/src/config.js';
import { silentLogger } from '../../../apps/local-bridge/src/logger.js';
import { TokenService, TokenServiceError } from '../../../apps/local-bridge/src/token-service.js';

const API_KEY = `AQ.${'k'.repeat(50)}`;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

function config(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiKey: API_KEY,
    gateSecret: 'g'.repeat(43),
    port: 47_821,
    host: '127.0.0.1',
    extensionIds: ['hhbdkheccnmpbdadhhppbemcjkaimlob'],
    extraOrigins: [],
    tokenTtlMs: 30 * 60_000,
    newSessionTtlMs: 60_000,
    rateLimitPerMinute: 30,
    logLevel: 'silent',
    envFile: 'test',
    allowedModels: ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking'],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('TokenService.mint', () => {
  it('sends the verified nested setup shape and returns a single-use token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        name: 'auth_tokens/token-123',
        expireTime: '2026-11-03T12:30:00Z',
        newSessionExpireTime: '2026-11-03T12:01:00Z',
      }),
    );
    const service = new TokenService(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    const token = await service.mint('gemini-3.8-live');

    expect(token).toEqual({
      token: 'auth_tokens/token-123',
      model: 'gemini-3.8-live',
      newSessionExpiresAt: new Date(NOW + 60_000).toISOString(),
      expiresAt: new Date(NOW + 1_800_000).toISOString(),
      singleUse: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-goog-api-key': API_KEY,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      uses: 1,
      expireTime: new Date(NOW + 1_800_000).toISOString(),
      newSessionExpireTime: new Date(NOW + 60_000).toISOString(),
      bidiGenerateContentSetup: {
        model: 'models/gemini-3.8-live',
        generationConfig: { responseModalities: ['AUDIO'] },
      },
      fieldMask: 'model,generationConfig.responseModalities',
    });
    // The permanent key must never appear in the body.
    expect(String(init.body)).not.toContain(API_KEY);
  });

  it('rejects unsupported models before making a network call', async () => {
    const fetchImpl = vi.fn();
    const service = new TokenService(config(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    await expect(service.mint('gemini-2.0-flash')).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 429 to a rate-limit error with the retry-after header', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () =>
        jsonResponse({ error: { message: 'Quota exceeded' } }, 429, {
          'retry-after': '42',
        })) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    const error = await service.mint('gemini-3.8-live').catch((caught) => caught);

    expect(error).toBeInstanceOf(TokenServiceError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 42_000 });
  });

  it('defaults the retry window when 429 has no usable header', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () =>
        jsonResponse({ error: { message: 'Quota exceeded' } }, 429)) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    await expect(service.mint('gemini-3.8-live')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 60_000,
    });
  });

  it('maps 401 and 403 to a configuration error', async () => {
    for (const status of [401, 403]) {
      const service = new TokenService(config(), {
        fetchImpl: (async () =>
          jsonResponse(
            { error: { message: 'API key not valid' } },
            status,
          )) as unknown as typeof fetch,
        now: () => NOW,
        logger: silentLogger,
      });
      await expect(service.mint('gemini-3.8-live')).rejects.toMatchObject({
        code: 'not_configured',
        status: 401,
      });
    }
  });

  it('redacts the API key if an upstream error echoes it', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () =>
        jsonResponse(
          { error: { message: `Invalid key ${API_KEY} supplied` } },
          400,
        )) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    const error = (await service
      .mint('gemini-3.8-live')
      .catch((caught) => caught)) as TokenServiceError;

    expect(error.code).toBe('invalid_request');
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain(API_KEY);
  });

  it('rejects an unexpected success payload', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () => jsonResponse({ name: 'not-a-token' })) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    await expect(service.mint('gemini-3.8-live')).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
    });
  });

  it('turns network failures into a 502 without leaking details', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () => {
        throw new Error('connect ECONNREFUSED 1.2.3.4');
      }) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    const error = await service.mint('gemini-3.8-live').catch((caught) => caught);

    expect(error).toMatchObject({ code: 'upstream_error', status: 502 });
    expect(error.message).not.toContain('1.2.3.4');
  });

  it('handles a non-JSON error body without throwing', async () => {
    const service = new TokenService(config(), {
      fetchImpl: (async () =>
        new Response('<html>bad gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })) as unknown as typeof fetch,
      now: () => NOW,
      logger: silentLogger,
    });

    await expect(service.mint('gemini-3.8-live')).rejects.toMatchObject({
      code: 'upstream_error',
      status: 502,
    });
  });
});
