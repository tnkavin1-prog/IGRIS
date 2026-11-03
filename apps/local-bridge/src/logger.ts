/** Minimal structured logger with defence-in-depth redaction. */
import type { BridgeConfig } from './config.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;

export interface Logger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

const SECRET_KEY_PATTERN = /(key|secret|token|authorization|password)/i;

/** Recursively redact values whose key looks secret, plus long token-like strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') {
    if (value.length > 40 && /^[A-Za-z0-9._\-+/=]{40,}$/.test(value)) return '[redacted]';
    return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(level: BridgeConfig['logLevel']): Logger {
  const threshold = LEVELS[level];
  const write = (
    lineLevel: keyof typeof LEVELS,
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    if (LEVELS[lineLevel] > threshold) return;
    const payload = {
      t: new Date().toISOString(),
      level: lineLevel,
      msg: message,
      ...(meta ? { meta: redact(meta) } : {}),
    };
    const line = JSON.stringify(payload);
    if (lineLevel === 'error') console.error(line);
    else if (lineLevel === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    error: (message, meta) => write('error', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    info: (message, meta) => write('info', message, meta),
    debug: (message, meta) => write('debug', message, meta),
  };
}

export const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};
