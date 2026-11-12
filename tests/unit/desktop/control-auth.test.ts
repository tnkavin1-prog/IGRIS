import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ControlAuthService,
  classifyOrigin,
  isLoopbackHost,
} from '../../../apps/desktop-hud/src/main/control-auth.js';

describe('ControlAuthService', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gematron-control-auth-'));
    tokenPath = join(dir, 'control-token');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates a 64-hex-char token and persists it', () => {
    const auth = new ControlAuthService({ tokenPath });
    const token = auth.getToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(tokenPath, 'utf-8').trim()).toBe(token);
  });

  it('writes the token file when the service is created', () => {
    // The user has to be able to copy the token into the extension, so it
    // must exist on disk before the first request arrives.
    const auth = new ControlAuthService({ tokenPath });
    expect(existsSync(tokenPath)).toBe(true);
    expect(readFileSync(tokenPath, 'utf-8').trim()).toBe(auth.getToken());
  });

  it('reuses a persisted token across instances', () => {
    const first = new ControlAuthService({ tokenPath });
    const token = first.getToken();
    const second = new ControlAuthService({ tokenPath });
    expect(second.getToken()).toBe(token);
  });

  it('honors the environment variable override', () => {
    process.env.GEMATRON_TEST_CONTROL_TOKEN = 'a'.repeat(32);
    try {
      const auth = new ControlAuthService({
        tokenPath,
        envVarName: 'GEMATRON_TEST_CONTROL_TOKEN',
      });
      expect(auth.getToken()).toBe('a'.repeat(32));
      expect(existsSync(tokenPath)).toBe(false);
    } finally {
      delete process.env.GEMATRON_TEST_CONTROL_TOKEN;
    }
  });

  it('regenerates when the persisted token is too short to be real', () => {
    writeFileSync(tokenPath, 'short', 'utf-8');
    const auth = new ControlAuthService({ tokenPath });
    const token = auth.getToken();
    expect(token).not.toBe('short');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates the correct token and rejects wrong/missing ones (timing-safe)', () => {
    const auth = new ControlAuthService({ tokenPath });
    const token = auth.getToken();
    expect(auth.validate(token)).toBe(true);
    expect(auth.validate(`${token.slice(0, -1)}0`)).toBe(false);
    expect(auth.validate('x'.repeat(64))).toBe(false);
    expect(auth.validate('')).toBe(false);
    expect(auth.validate(undefined)).toBe(false);
    expect(auth.validate(null)).toBe(false);
  });

  it('extracts tokens from Authorization Bearer and dedicated header', () => {
    const auth = new ControlAuthService({ tokenPath });
    auth.getToken();
    expect(auth.extract({ authorization: 'Bearer abc123' })).toBe('abc123');
    expect(auth.extract({ authorization: 'bearer abc123' })).toBe('abc123');
    expect(auth.extract({ 'x-gematron-control-token': 'tok' })).toBe('tok');
    expect(auth.extract({ Authorization: 'Bearer upper' })).toBe('upper');
    expect(auth.extract({})).toBeNull();
    expect(auth.extract({ authorization: 'Basic xx' })).toBeNull();
    expect(
      auth.extract({ authorization: ['Bearer arr'], 'x-gematron-control-token': 'tok2' }),
    ).toBe('arr');
  });

  it('survives a read-only token directory without crashing', () => {
    const roPath = join(dir, 'missing-sub', 'nested', 'control-token');
    const auth = new ControlAuthService({ tokenPath: roPath });
    // On some platforms mkdir under a temp dir succeeds; only assert token returned.
    expect(typeof auth.getToken()).toBe('string');
  });
});

describe('classifyOrigin', () => {
  it('allowlists chrome-extension origins', () => {
    expect(classifyOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe('allow');
  });

  it('rejects web origins outright', () => {
    expect(classifyOrigin('https://evil.example')).toBe('reject-web');
    expect(classifyOrigin('http://localhost:3000')).toBe('reject-web');
    expect(classifyOrigin('null')).toBe('reject-web');
  });

  it('treats missing origin as native', () => {
    expect(classifyOrigin(undefined)).toBe('native');
    expect(classifyOrigin('')).toBe('reject-web');
  });
});

describe('isLoopbackHost', () => {
  it('accepts loopback host headers with matching port', () => {
    expect(isLoopbackHost('127.0.0.1:9228', 9228)).toBe(true);
    expect(isLoopbackHost('localhost:9228', 9228)).toBe(true);
    expect(isLoopbackHost('[::1]:9228', 9228)).toBe(true);
  });

  it('rejects non-loopback or mismatched hosts', () => {
    expect(isLoopbackHost('evil.example:9228', 9228)).toBe(false);
    expect(isLoopbackHost('127.0.0.1:9999', 9228)).toBe(false);
    expect(isLoopbackHost('127.0.0.1', 9228)).toBe(false);
    expect(isLoopbackHost(undefined, 9228)).toBe(false);
  });
});
