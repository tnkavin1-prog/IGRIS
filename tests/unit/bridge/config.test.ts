import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, maskSecret, parseDotEnv } from '../../../apps/local-bridge/src/config.js';

const API_KEY = `AQ.${'a'.repeat(50)}`;
const GATE_SECRET = 'g'.repeat(43);

const directories: string[] = [];

function envFileWith(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'gbl-config-'));
  directories.push(directory);
  const file = join(directory, '.env');
  writeFileSync(file, contents, 'utf8');
  return file;
}

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe('parseDotEnv', () => {
  it('parses comments, blanks, quotes, and values containing equals signs', () => {
    const parsed = parseDotEnv(
      [
        '# comment',
        '',
        'PLAIN=value',
        'QUOTED="hello world"',
        "SINGLE='single value'",
        'WITH_EQUALS=a=b=c',
        '  SPACED  =  trimmed  ',
        'NO_VALUE',
      ].join('\r\n'),
    );

    expect(parsed).toEqual({
      PLAIN: 'value',
      QUOTED: 'hello world',
      SINGLE: 'single value',
      WITH_EQUALS: 'a=b=c',
      SPACED: 'trimmed',
    });
  });

  it('ignores a UTF-8 BOM written by Windows tooling', () => {
    expect(parseDotEnv('\uFEFFGEMINI_API_KEY=value')).toEqual({ GEMINI_API_KEY: 'value' });
  });
});

describe('loadConfig', () => {
  it('loads a valid file and derives durations and allowlists', () => {
    const envFile = envFileWith(
      [
        `GEMINI_API_KEY=${API_KEY}`,
        `LOCAL_GATE_SECRET=${GATE_SECRET}`,
        'PORT=49000',
        'ALLOWED_EXTENSION_IDS=HHBDKHECCNMPBDADHHPPBEMCJKAIMLOB, not-an-id',
        'ALLOWED_ORIGINS=http://127.0.0.1:3000, http://localhost:5173',
        'TOKEN_TTL_MINUTES=15',
        'NEW_SESSION_TTL_SECONDS=45',
        'RATE_LIMIT_PER_MINUTE=12',
        'LOG_LEVEL=debug',
      ].join('\n'),
    );

    const result = loadConfig({ envFile, processEnv: {} });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.config).toMatchObject({
      apiKey: API_KEY,
      gateSecret: GATE_SECRET,
      port: 49000,
      extensionIds: ['hhbdkheccnmpbdadhhppbemcjkaimlob'],
      extraOrigins: ['http://127.0.0.1:3000', 'http://localhost:5173'],
      tokenTtlMs: 900_000,
      newSessionTtlMs: 45_000,
      rateLimitPerMinute: 12,
      logLevel: 'debug',
      envFile,
    });
    expect(result.config?.allowedModels).toContain('gemini-3.8-live');
  });

  it('applies documented defaults when optional values are absent', () => {
    const envFile = envFileWith(
      [`GEMINI_API_KEY=${API_KEY}`, `LOCAL_GATE_SECRET=${GATE_SECRET}`].join('\n'),
    );

    const result = loadConfig({ envFile, processEnv: {} });

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({
      port: 47_821,
      tokenTtlMs: 30 * 60_000,
      newSessionTtlMs: 60_000,
      rateLimitPerMinute: 30,
      logLevel: 'info',
    });
    expect(result.config?.extensionIds).toEqual([]);
  });

  it('lets the process environment override the file', () => {
    const envFile = envFileWith(
      [`GEMINI_API_KEY=${API_KEY}`, `LOCAL_GATE_SECRET=${GATE_SECRET}`, 'PORT=49000'].join('\n'),
    );

    const result = loadConfig({ envFile, processEnv: { PORT: '50001' } });

    expect(result.ok).toBe(true);
    expect(result.config?.port).toBe(50001);
  });

  it('rejects a missing API key with a field-specific error', () => {
    const envFile = envFileWith(`LOCAL_GATE_SECRET=${GATE_SECRET}`);

    const result = loadConfig({ envFile, processEnv: {} });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('GEMINI_API_KEY');
  });

  it('rejects placeholder and whitespace-containing keys', () => {
    const placeholder = loadConfig({
      envFile: envFileWith(`GEMINI_API_KEY=PASTE_YOUR_KEY_HERE\nLOCAL_GATE_SECRET=${GATE_SECRET}`),
      processEnv: {},
    });
    const whitespace = loadConfig({
      envFile: envFileWith(`GEMINI_API_KEY="AQ.key with space"\nLOCAL_GATE_SECRET=${GATE_SECRET}`),
      processEnv: {},
    });

    expect(placeholder.ok).toBe(false);
    expect(placeholder.errors.join(' ')).toContain('placeholder');
    expect(whitespace.ok).toBe(false);
    expect(whitespace.errors.join(' ')).toContain('whitespace');
  });

  it('rejects a short gate secret and out-of-range ports', () => {
    const result = loadConfig({
      envFile: envFileWith(`GEMINI_API_KEY=${API_KEY}\nLOCAL_GATE_SECRET=short\nPORT=80`),
      processEnv: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('LOCAL_GATE_SECRET');
    expect(result.errors.join(' ')).toContain('PORT');
  });

  it('rejects an invalid log level rather than silently defaulting', () => {
    const result = loadConfig({
      envFile: envFileWith(
        [`GEMINI_API_KEY=${API_KEY}`, `LOCAL_GATE_SECRET=${GATE_SECRET}`, 'LOG_LEVEL=verbose'].join(
          '\n',
        ),
      ),
      processEnv: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('LOG_LEVEL');
  });
});

describe('maskSecret', () => {
  it('never reveals more than a few characters', () => {
    expect(maskSecret(undefined)).toBe('(unset)');
    expect(maskSecret('')).toBe('(unset)');
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abcdefghij')).toBe('abc…ij (10 chars)');
  });
});
