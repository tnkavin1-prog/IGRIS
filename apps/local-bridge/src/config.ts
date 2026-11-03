/**
 * Bridge configuration.
 *
 * The permanent Gemini API key exists only in this process. It is loaded from
 * an untracked `.env` file, validated once, and never logged or returned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ALLOWED_MODEL_IDS, BRIDGE_HOST, BRIDGE_PORT } from '@gbl/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** src/ → local-bridge/ ; dist/ → local-bridge/ */
export const BRIDGE_ROOT = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(BRIDGE_ROOT, '..', '..');

const EnvSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(20, 'GEMINI_API_KEY looks too short.')
    .refine((v) => !/^(PASTE_|REPLACE_|YOUR_)/i.test(v), 'GEMINI_API_KEY is still a placeholder.')
    .refine((v) => !/\s/.test(v), 'GEMINI_API_KEY must not contain whitespace.'),
  LOCAL_GATE_SECRET: z
    .string()
    .min(32, 'LOCAL_GATE_SECRET must be at least 32 characters. Generate 32 random bytes.')
    .refine((v) => !/^REPLACE_/i.test(v), 'LOCAL_GATE_SECRET is still a placeholder.'),
  PORT: z.coerce.number().int().min(1024).max(65_535).default(BRIDGE_PORT),
  ALLOWED_EXTENSION_IDS: z.string().default(''),
  TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(30),
  NEW_SESSION_TTL_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(30),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),
  ALLOWED_ORIGINS: z.string().default(''),
});

export interface BridgeConfig {
  apiKey: string;
  gateSecret: string;
  port: number;
  host: typeof BRIDGE_HOST;
  extensionIds: string[];
  extraOrigins: string[];
  tokenTtlMs: number;
  newSessionTtlMs: number;
  rateLimitPerMinute: number;
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  envFile: string;
  allowedModels: readonly string[];
}

export function parseDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveEnvFile(): string {
  const explicit = process.env.GBL_ENV_FILE;
  if (explicit) return path.resolve(explicit);
  const candidates = [path.join(BRIDGE_ROOT, '.env'), path.join(REPO_ROOT, '.env')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export interface ConfigLoadResult {
  ok: boolean;
  config?: BridgeConfig;
  errors: string[];
  envFile: string;
}

export function loadConfig(
  options: { envFile?: string; processEnv?: NodeJS.ProcessEnv } = {},
): ConfigLoadResult {
  const envFile = options.envFile ?? resolveEnvFile();
  const processEnv = options.processEnv ?? process.env;
  const fileValues = fs.existsSync(envFile) ? parseDotEnv(fs.readFileSync(envFile, 'utf8')) : {};
  // Process environment wins so CI/tests can inject values without touching disk.
  const merged: Record<string, string> = { ...fileValues };
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) merged[key] = value;
  }

  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      envFile,
      errors: parsed.error.issues.map((issue) => {
        const where = issue.path.join('.');
        return where ? `${where}: ${issue.message}` : issue.message;
      }),
    };
  }

  const env = parsed.data;
  const extensionIds = env.ALLOWED_EXTENSION_IDS.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-p]{32}$/.test(value));
  const extraOrigins = env.ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ok: true,
    envFile,
    errors: [],
    config: {
      apiKey: env.GEMINI_API_KEY,
      gateSecret: env.LOCAL_GATE_SECRET,
      port: env.PORT,
      host: BRIDGE_HOST,
      extensionIds,
      extraOrigins,
      tokenTtlMs: env.TOKEN_TTL_MINUTES * 60_000,
      newSessionTtlMs: env.NEW_SESSION_TTL_SECONDS * 1_000,
      rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
      logLevel: env.LOG_LEVEL,
      envFile,
      allowedModels: ALLOWED_MODEL_IDS,
    },
  };
}

/** Mask a secret for diagnostics. Never returns more than 6 characters. */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(unset)';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`;
}
