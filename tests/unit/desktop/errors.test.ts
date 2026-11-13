import { describe, expect, it } from 'vitest';
import {
  AppError,
  NotFoundError,
  PermissionError,
  SafetyError,
  TimeoutError,
  ValidationError,
  createLogger,
  isAppError,
  logger,
} from '../../../apps/desktop-hud/src/main/errors.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('typed errors', () => {
  it('carries a stable code, status and operational flag', () => {
    const error = new ValidationError([{ field: 'name', message: 'required' }]);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(422);
    expect(error.isOperational).toBe(true);
    expect(error.fields).toHaveLength(1);
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error('nope'))).toBe(false);
  });

  it('distinguishes the failure modes by status code', () => {
    expect(new NotFoundError('file', 'x.pdf').statusCode).toBe(404);
    expect(new PermissionError('no').statusCode).toBe(403);
    expect(new SafetyError('no').statusCode).toBe(403);
    expect(new TimeoutError('no').statusCode).toBe(408);
  });

  it('is an instance of Error', () => {
    const error = new AppError('boom', 'BOOM', 500, false);
    expect(error instanceof Error).toBe(true);
    expect(error.isOperational).toBe(false);
  });
});

describe('structured logger', () => {
  it('writes one JSON record per call and redacts sensitive fields', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'log-'));
    const previous = process.env.GEMATRON_DATA_DIR;
    process.env.GEMATRON_DATA_DIR = dir;
    try {
      const log = createLogger('test', { logDir: dir });
      log.info('hello', { apiKey: 'secret-value', step: 'launch' });
      log.error('boom', { password: 'hunter2', nested: { token: 'abc' } });

      const lines = readFileSync(join(dir, 'test.log'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]!);
      expect(first.level).toBe('info');
      expect(first.message).toBe('hello');
      expect(first.context.apiKey).toBe('[REDACTED]');
      expect(first.context.step).toBe('launch');

      const second = JSON.parse(lines[1]!);
      expect(second.level).toBe('error');
      expect(second.context.password).toBe('[REDACTED]');
      expect(second.context.nested.token).toBe('[REDACTED]');
    } finally {
      if (previous === undefined) delete process.env.GEMATRON_DATA_DIR;
      else process.env.GEMATRON_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('truncates long strings and caps arrays', () => {
    const dir = mkdtempSync(join(process.cwd(), 'temp', 'log-'));
    const previous = process.env.GEMATRON_DATA_DIR;
    process.env.GEMATRON_DATA_DIR = dir;
    try {
      const log = createLogger('truncate', { logDir: dir });
      log.info('big', { text: 'x'.repeat(500), list: Array.from({ length: 100 }, (_, i) => i) });
      const record = JSON.parse(readFileSync(join(dir, 'truncate.log'), 'utf8').trim());
      expect(record.context.text).toContain('…');
      expect(record.context.list).toHaveLength(50);
    } finally {
      if (previous === undefined) delete process.env.GEMATRON_DATA_DIR;
      else process.env.GEMATRON_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('default logger', () => {
  it('is exported as a logger object', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
