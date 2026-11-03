import { describe, expect, it } from 'vitest';
import {
  extractBearer,
  isAllowedHostHeader,
  isAllowedOrigin,
  originFromExtensionId,
  timingSafeEqualString,
} from '../../../apps/local-bridge/src/auth.js';
import type { BridgeConfig } from '../../../apps/local-bridge/src/config.js';

const EXTENSION_ID = 'hhbdkheccnmpbdadhhppbemcjkaimlob';

function config(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    apiKey: `AQ.${'a'.repeat(50)}`,
    gateSecret: 'g'.repeat(43),
    port: 47_821,
    host: '127.0.0.1',
    extensionIds: [EXTENSION_ID],
    extraOrigins: [],
    tokenTtlMs: 1_800_000,
    newSessionTtlMs: 60_000,
    rateLimitPerMinute: 30,
    logLevel: 'silent',
    envFile: 'test',
    allowedModels: ['gemini-3.8-live'],
    ...overrides,
  };
}

describe('timingSafeEqualString', () => {
  it('compares equal secrets correctly', () => {
    expect(timingSafeEqualString('secret-value', 'secret-value')).toBe(true);
  });

  it('rejects different values and empty inputs', () => {
    expect(timingSafeEqualString('secret-value', 'secret-valuf')).toBe(false);
    expect(timingSafeEqualString('short', 'a much longer value')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(false);
    expect(timingSafeEqualString('secret', '')).toBe(false);
    expect(timingSafeEqualString('', 'secret')).toBe(false);
  });
});

describe('extractBearer', () => {
  it('extracts a case-insensitive bearer token', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
    expect(extractBearer('bearer abc123')).toBe('abc123');
    expect(extractBearer('  Bearer   abc123  ')).toBe('abc123');
  });

  it('accepts the first value of a repeated header', () => {
    expect(extractBearer(['Bearer first', 'Bearer second'])).toBe('first');
  });

  it('returns an empty string for missing or malformed headers', () => {
    expect(extractBearer(undefined)).toBe('');
    expect(extractBearer('')).toBe('');
    expect(extractBearer('Basic abc123')).toBe('Basic abc123');
  });
});

describe('isAllowedOrigin', () => {
  it('allows only the allowlisted extension id', () => {
    expect(isAllowedOrigin(originFromExtensionId(EXTENSION_ID), config())).toBe(true);
    expect(isAllowedOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', config())).toBe(
      false,
    );
  });

  it('refuses every extension when the allowlist is empty', () => {
    expect(isAllowedOrigin(originFromExtensionId(EXTENSION_ID), config({ extensionIds: [] }))).toBe(
      false,
    );
  });

  it('allows loopback origins on the configured port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:47821', config())).toBe(true);
    expect(isAllowedOrigin('http://localhost:47821', config())).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:47822', config())).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:47821.evil.com', config())).toBe(false);
  });

  it('honours explicitly configured extra origins', () => {
    const withExtra = config({ extraOrigins: ['https://dashboard.example.com'] });
    expect(isAllowedOrigin('https://dashboard.example.com', withExtra)).toBe(true);
    expect(isAllowedOrigin('https://other.example.com', withExtra)).toBe(false);
  });

  it('refuses missing and opaque origins', () => {
    expect(isAllowedOrigin(undefined, config())).toBe(false);
    expect(isAllowedOrigin('', config())).toBe(false);
    expect(isAllowedOrigin('null', config())).toBe(false);
    expect(isAllowedOrigin('https://example.com', config())).toBe(false);
  });
});

describe('isAllowedHostHeader', () => {
  it('accepts loopback host headers on the configured port', () => {
    expect(isAllowedHostHeader('127.0.0.1:47821', 47_821)).toBe(true);
    expect(isAllowedHostHeader('localhost:47821', 47_821)).toBe(true);
    expect(isAllowedHostHeader('[::1]:47821', 47_821)).toBe(true);
    expect(isAllowedHostHeader('LOCALHOST:47821', 47_821)).toBe(true);
  });

  it('rejects DNS-rebinding hosts and wrong ports', () => {
    expect(isAllowedHostHeader('evil.example.com:47821', 47_821)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1:9999', 47_821)).toBe(false);
    expect(isAllowedHostHeader('127.0.0.1', 47_821)).toBe(false);
    expect(isAllowedHostHeader(undefined, 47_821)).toBe(false);
  });
});
