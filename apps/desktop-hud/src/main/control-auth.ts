/**
 * ControlAuthService — shared-secret authentication for the loopback desktop
 * control API (ControlServer on 127.0.0.1).
 *
 * The token is generated once (32 cryptographically random bytes, hex) and
 * persisted next to other writable state. Every mutating route requires it;
 * first-party `chrome-extension://` origins are allowlisted by origin instead
 * (a web page can never present that origin), and web origins are rejected
 * outright so no unauthenticated HTTP surface remains.
 *
 * Validation is timing-safe: SHA-256 digests are compared with
 * timingSafeEqual so token length never leaks and comparisons cannot be
 * timed against the raw secret.
 */
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DATA_ROOT } from './runtime-paths.js';

export const CONTROL_TOKEN_HEADER = 'x-gematron-control-token';
export const CONTROL_TOKEN_FILE = join(DATA_ROOT, 'control-token');

export interface ControlAuthOptions {
  /** Override file location (tests). */
  tokenPath?: string;
  /** Environment variable consulted before the file (dev/test overrides). */
  envVarName?: string;
  /** Random source override (tests). */
  tokenGenerator?: () => string;
}

export class ControlAuthService {
  private cached: string | null = null;

  constructor(private readonly options: ControlAuthOptions = {}) {}

  /** Load (or generate-and-persist) the permanent control token. */
  public getToken(): string {
    if (this.cached) return this.cached;

    const envName = this.options.envVarName;
    if (envName && process.env[envName]) {
      this.cached = String(process.env[envName]);
      return this.cached;
    }

    const path = this.options.tokenPath ?? CONTROL_TOKEN_FILE;
    try {
      if (existsSync(path)) {
        const existing = readFileSync(path, 'utf-8').trim();
        if (existing.length >= 32) {
          this.cached = existing;
          return this.cached;
        }
      }
    } catch {
      /* fall through to regeneration */
    }

    const generated = this.options.tokenGenerator
      ? this.options.tokenGenerator()
      : randomBytes(32).toString('hex');
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${generated}\n`, { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* read-only media: token stays process-local this run */
    }
    this.cached = generated;
    return this.cached;
  }

  /** Timing-safe comparison of a candidate against the stored token. */
  public validate(candidate: string | undefined | null): boolean {
    if (!candidate) return false;
    const expected = createHash('sha256').update(this.getToken()).digest();
    const provided = createHash('sha256').update(candidate).digest();
    return timingSafeEqual(expected, provided);
  }

  /**
   * Extract a candidate token from request headers: `Authorization: Bearer <t>`
   * first, then the dedicated `X-Gematron-Control-Token` header.
   */
  public extract(headers: Record<string, string | string[] | undefined>): string | null {
    const auth = headerValue(headers, 'authorization');
    if (auth) {
      const match = /^Bearer\s+(.+)$/i.exec(auth);
      if (match?.[1]) return match[1].trim();
    }
    return headerValue(headers, CONTROL_TOKEN_HEADER);
  }

  /** Forget the in-memory token (next getToken regenerates/reads). */
  public reset(): void {
    this.cached = null;
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.length > 0) return direct;
  if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0];
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      if (typeof value === 'string' && value.length > 0) return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return null;
}

export type OriginDecision = 'allow' | 'reject-web' | 'native';

/**
 * Classify a request's Origin header for the loopback control API.
 * - `chrome-extension://…` → first-party surface, allowed without a token.
 * - Any http(s)/other web origin → rejected outright (browser always attaches
 *   a truthful Origin to cross-origin fetches, so web pages cannot bypass).
 * - No Origin header → native client (scripts, curl, the HUD itself).
 */
export function classifyOrigin(origin: string | undefined): OriginDecision {
  // A genuinely absent Origin header is a native caller (curl, the desktop
  // app, the local bridge). An *empty* header is not the same thing: it is
  // only present when the peer explicitly sent one, so treat it as hostile.
  if (origin === undefined) return 'native';
  if (!origin.trim()) return 'reject-web';
  if (/^chrome-extension:\/\//i.test(origin)) return 'allow';
  if (/^https?:\/\//i.test(origin)) return 'reject-web';
  return 'reject-web';
}

/**
 * Host-header pin: only loopback hosts are accepted, defeating DNS-rebinding
 * attempts where a public hostname resolves to 127.0.0.1.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    normalized === `127.0.0.1:${port}` ||
    normalized === `[::1]:${port}` ||
    normalized === `localhost:${port}`
  );
}
