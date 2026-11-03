/**
 * Client for the loopback token bridge.
 *
 * The extension never sees GEMINI_API_KEY. It authenticates to the bridge with
 * a separately generated LOCAL_GATE_SECRET, which the user pastes once into
 * Settings and which is stored only in chrome.storage.local.
 */
import {
  BRIDGE_CONFIG_PATH,
  BRIDGE_HEALTH_PATH,
  BRIDGE_ORIGIN,
  BRIDGE_TOKEN_PATH,
  type BridgeErrorBody,
  type BridgeHealth,
  type TokenResponse,
} from '@gbl/shared';

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: BridgeErrorBody['code'] | 'network_error' | 'timeout',
    readonly status = 0,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export interface BridgeClientOptions {
  baseUrl?: string;
  secret: string;
}

const HEALTH_TIMEOUT_MS = 4_000;
const TOKEN_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') {
      throw new BridgeError('The local bridge did not respond in time.', 'timeout');
    }
    throw new BridgeError(
      'The local bridge is unreachable. Start it with "npm run bridge" and try again.',
      'network_error',
    );
  } finally {
    clearTimeout(timer);
  }
}

function asBridgeError(status: number, body: unknown): BridgeError {
  const parsed = body as Partial<BridgeErrorBody> | null;
  const message =
    parsed && typeof parsed.error === 'string'
      ? parsed.error
      : `The local bridge returned HTTP ${status}.`;
  const code =
    parsed && typeof parsed.code === 'string'
      ? (parsed.code as BridgeErrorBody['code'])
      : 'upstream_error';
  return new BridgeError(message, code, status, Number(parsed?.retryAfterMs ?? 0));
}

export class BridgeClient {
  readonly baseUrl: string;
  private secret: string;

  constructor(options: BridgeClientOptions) {
    this.baseUrl = (options.baseUrl || BRIDGE_ORIGIN).replace(/\/+$/, '');
    this.secret = options.secret.trim();
  }

  setSecret(secret: string): void {
    this.secret = secret.trim();
  }

  get hasSecret(): boolean {
    return this.secret.length > 0;
  }

  async health(): Promise<BridgeHealth> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}${BRIDGE_HEALTH_PATH}`,
      { method: 'GET', cache: 'no-store' },
      HEALTH_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw asBridgeError(response.status, body);
    return body as BridgeHealth;
  }

  async config(): Promise<{
    version: string;
    allowedModels: string[];
    tokenTtlMs: number;
    newSessionTtlMs: number;
    rateLimitPerMinute: number;
  }> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}${BRIDGE_CONFIG_PATH}`,
      { method: 'GET', cache: 'no-store' },
      HEALTH_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw asBridgeError(response.status, body);
    return body as {
      version: string;
      allowedModels: string[];
      tokenTtlMs: number;
      newSessionTtlMs: number;
      rateLimitPerMinute: number;
    };
  }

  async token(model: string): Promise<TokenResponse> {
    if (!this.secret) {
      throw new BridgeError(
        'Enter the local bridge secret in Settings. It is printed by the setup script.',
        'unauthorized',
        401,
      );
    }
    const response = await fetchWithTimeout(
      `${this.baseUrl}${BRIDGE_TOKEN_PATH}`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify({ model }),
      },
      TOKEN_TIMEOUT_MS,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw asBridgeError(response.status, body);
    const token = body as Partial<TokenResponse> | null;
    if (!token || typeof token.token !== 'string' || !token.token.startsWith('auth_tokens/')) {
      throw new BridgeError('The local bridge returned an invalid token.', 'upstream_error', 502);
    }
    return token as TokenResponse;
  }
}
