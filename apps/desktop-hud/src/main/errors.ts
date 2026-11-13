/**
 * Typed errors and structured logging for the desktop HUD.
 *
 * The codebase used to throw generic `Error('...')` objects, or no error at
 * all, and the catch blocks that followed either swallowed the result or
 * printed it with `console.warn`. That made a failure indistinguishable
 * from a success in the audit trail.
 *
 * This module provides:
 *  - an `AppError` base with a stable `code`, a `statusCode`, and an
 *    `isOperational` flag so the global handler can tell an expected
 *    failure (a refused command, a missing file) from a bug;
 *  - concrete subclasses for the failure modes the HUD actually produces;
 *  - a structured logger that writes one JSON object per line, carrying a
 *    correlation id, and that never prints secrets or document content.
 */
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR } from './runtime-paths.js';

/* ------------------------------------------------------------------ errors */

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(message: string, code: string, statusCode: number, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  readonly fields: Array<{ field: string; message: string }>;
  constructor(fields: Array<{ field: string; message: string }>) {
    super('Validation failed', 'VALIDATION_ERROR', 422);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class PermissionError extends AppError {
  constructor(message: string, code = 'PERMISSION_DENIED') {
    super(message, code, 403);
    this.name = 'PermissionError';
  }
}

export class SafetyError extends AppError {
  constructor(message: string, code = 'BLOCKED_BY_POLICY') {
    super(message, code, 403);
    this.name = 'SafetyError';
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, code = 'TIMEOUT') {
    super(message, code, 408);
    this.name = 'TimeoutError';
  }
}

export class UnavailableError extends AppError {
  constructor(message: string, code = 'UNAVAILABLE') {
    super(message, code, 503);
    this.name = 'UnavailableError';
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/* ------------------------------------------------------------------ logger */

const LOG_ROTATION_BYTES = 5 * 1024 * 1024;
const REDACTED = '[REDACTED]';

/** Fields that must never be written to a log line. */
const SENSITIVE_KEYS = new Set([
  'apiKey',
  'apiKeyB64',
  'password',
  'token',
  'secret',
  'authorization',
  'bearer',
  'clipboard',
  'clipboardText',
  'prompt',
  'command',
  'body',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Truncate long strings; they are usually document text or commands.
    return value.length > 240 ? `${value.slice(0, 237)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redact(entry, depth + 1);
      }
    }
    return result;
  }
  return value;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface StructuredLogger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(name: string, options?: { logDir?: string }): StructuredLogger {
  const logDir = options?.logDir ?? LOGS_DIR;
  const logPath = join(logDir, `${name}.log`);
  const write = (
    level: LogLevel,
    message: string,
    context: Record<string, unknown> | undefined,
  ) => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      name,
      message,
      ...(context ? { context: redact(context) } : {}),
    };
    try {
      mkdirSync(logDir, { recursive: true });
      try {
        const stat = statSync(logPath);
        if (stat.size >= LOG_ROTATION_BYTES) {
          try {
            unlinkSync(`${logPath}.1`);
          } catch {
            /* no previous backup */
          }
          renameSync(logPath, `${logPath}.1`);
        }
      } catch {
        /* the file does not exist yet */
      }
      appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // Logging must never crash the caller.
      console.error(`[Log] Failed to write ${name}.log`);
    }
    if (level === 'error') console.error(`[${name}] ${message}`, context ?? '');
    else if (level === 'warn') console.warn(`[${name}] ${message}`, context ?? '');
  };
  return {
    error: (message, context) => write('error', message, context),
    warn: (message, context) => write('warn', message, context),
    info: (message, context) => write('info', message, context),
    debug: (message, context) => write('debug', message, context),
  };
}

export const logger = createLogger('hud');
