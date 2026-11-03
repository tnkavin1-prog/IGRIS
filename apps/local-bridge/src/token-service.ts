/**
 * Mints short-lived, single-use Gemini Live ephemeral tokens.
 *
 * Verified request shape (2026-11-03): the v1beta REST surface accepts
 * `bidiGenerateContentSetup` + `fieldMask`; it rejects the newer
 * `liveConnectConstraints` field with HTTP 400. We therefore lock the model and
 * audio modality server-side and let the client provide its system
 * instruction, tools, and session options in the Live setup message.
 *
 * The permanent API key never leaves this process.
 */
import { z } from 'zod';
import type { TokenResponse } from '@gbl/shared';
import type { BridgeConfig } from './config.js';
import type { Logger } from './logger.js';

const TokenUpstreamSchema = z.object({
  name: z.string().regex(/^auth_tokens\/[\w.-]+$/, 'Unexpected auth token identifier.'),
  expireTime: z.string().optional(),
  newSessionExpireTime: z.string().optional(),
});

export type TokenErrorCode =
  'invalid_request' | 'not_configured' | 'rate_limited' | 'upstream_error';

export class TokenServiceError extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TokenServiceError';
  }
}

export interface TokenServiceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  logger?: Logger;
}

const UPSTREAM_TIMEOUT_MS = 15_000;

export class TokenService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly logger: Logger | undefined;

  constructor(
    private readonly config: BridgeConfig,
    deps: TokenServiceDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger;
  }

  async mint(model: string): Promise<TokenResponse> {
    if (!this.config.allowedModels.includes(model)) {
      throw new TokenServiceError('invalid_request', 'Unsupported Live model.', 400);
    }

    const now = this.now();
    const expiresAt = new Date(now + this.config.tokenTtlMs);
    const newSessionExpiresAt = new Date(now + this.config.newSessionTtlMs);

    const payload = {
      uses: 1,
      expireTime: expiresAt.toISOString(),
      newSessionExpireTime: newSessionExpiresAt.toISOString(),
      bidiGenerateContentSetup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'] },
      },
      fieldMask: 'model,generationConfig.responseModalities',
    };

    let response: Response;
    try {
      response = await this.fetchImpl(
        'https://generativelanguage.googleapis.com/v1beta/auth_tokens',
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        },
      );
    } catch (error) {
      this.logger?.error('token upstream unreachable', { error: String(error) });
      throw new TokenServiceError(
        'upstream_error',
        'Could not reach the Gemini token service. Check the network connection.',
        502,
      );
    }

    const bodyText = await response.text().catch(() => '');
    const parsedJson = safeJson(bodyText);

    if (!response.ok) {
      throw this.mapUpstreamError(response, parsedJson);
    }

    const parsed = TokenUpstreamSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger?.error('token upstream returned an unexpected payload', {
        issues: parsed.error.issues.map((i) => i.message),
      });
      throw new TokenServiceError(
        'upstream_error',
        'The Gemini token service returned an unexpected response.',
        502,
      );
    }

    this.logger?.info('ephemeral token minted', {
      model,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      token: parsed.data.name,
      model,
      newSessionExpiresAt: newSessionExpiresAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      singleUse: true,
    };
  }

  private mapUpstreamError(response: Response, body: unknown): TokenServiceError {
    const upstreamMessage =
      (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
        ? body.error.message
        : '') || `Gemini returned HTTP ${response.status}`;
    const message = this.redact(upstreamMessage).slice(0, 300);

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const retryAfterMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 60_000;
      return new TokenServiceError(
        'rate_limited',
        'Gemini rate limit or quota reached. Wait before trying again.',
        429,
        retryAfterMs,
      );
    }
    if (response.status === 401 || response.status === 403) {
      return new TokenServiceError(
        'not_configured',
        'Gemini rejected the API key. Check GEMINI_API_KEY and that the key has Live API access.',
        401,
      );
    }
    if (response.status === 400) {
      return new TokenServiceError('invalid_request', message, 400);
    }
    return new TokenServiceError('upstream_error', message, 502);
  }

  /** Defensive: upstream errors must never echo the key back to the client. */
  private redact(text: string): string {
    return text.split(this.config.apiKey).join('[redacted]');
  }
}

function safeJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
