/**
 * HTTP surface of the local bridge.
 *
 * Deliberately implemented on `node:http` with no framework: the attack surface
 * is tiny, the routing is three routes, and every security control (host check,
 * origin allowlist, body limit, rate limit) is explicit and unit-testable.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BRIDGE_CONFIG_PATH,
  BRIDGE_HEALTH_PATH,
  BRIDGE_TOKEN_PATH,
  BRIDGE_PIN_PATH,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  type BridgeErrorBody,
  type BridgeHealth,
} from '@gbl/shared';
import { SCRIPTS_DIR } from '../../desktop-hud/src/main/runtime-paths.js';
import {
  isAllowedHostHeader,
  isAllowedOrigin,
  extractBearer,
  timingSafeEqualString,
} from './auth.js';
import type { BridgeConfig } from './config.js';
import type { Logger } from './logger.js';
import { SlidingWindowRateLimiter } from './rate-limit.js';
import { TokenService, TokenServiceError } from './token-service.js';

const MAX_BODY_BYTES = 8 * 1024;
const RATE_WINDOW_MS = 60_000;

const TokenRequestSchema = z.object({
  model: z.string().min(1).max(120),
});

export interface BridgeDeps {
  logger: Logger;
  tokenService?: TokenService;
  now?: () => number;
}

export interface BridgeApp {
  server: http.Server;
  tokenService: TokenService;
  rateLimiter: SlidingWindowRateLimiter;
}

function securityHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  };
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders(),
    ...(origin ? corsHeaders(origin) : {}),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function sendError(
  res: http.ServerResponse,
  status: number,
  code: BridgeErrorBody['code'],
  message: string,
  origin: string | null,
  extra: Partial<BridgeErrorBody> = {},
): void {
  const body: BridgeErrorBody = { error: message, code, ...extra };
  sendJson(res, status, body, origin);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted.')));
  });
}

export function createBridgeApp(config: BridgeConfig, deps: BridgeDeps): BridgeApp {
  const now = deps.now ?? Date.now;
  const logger = deps.logger;
  const tokenService = deps.tokenService ?? new TokenService(config, { logger, now });
  const rateLimiter = new SlidingWindowRateLimiter(config.rateLimitPerMinute, RATE_WINDOW_MS, now);

  const health: BridgeHealth = {
    ok: true,
    service: `${PRODUCT_NAME} local bridge`,
    version: PRODUCT_VERSION,
    configured: true,
    keyConfigured: Boolean(config.apiKey),
    secretConfigured: Boolean(config.gateSecret),
    originsConfigured: config.extensionIds.length > 0,
    allowedModels: [...config.allowedModels],
    serverTime: new Date(now()).toISOString(),
  };

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      logger.error('unhandled request failure', { error: String(error) });
      if (!res.headersSent) {
        sendError(res, 500, 'upstream_error', 'Unexpected bridge error.', null);
      } else {
        res.end();
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startedAt = now();
    const originHeader = req.headers.origin;
    const origin = typeof originHeader === 'string' ? originHeader : null;
    const host = req.headers.host;
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', `http://${host ?? '127.0.0.1'}`).pathname;
    // Never reflect an unlisted origin, even on endpoints that are readable
    // without one. CORS is a capability, not a header-formatting detail.
    const corsOrigin = origin && isAllowedOrigin(origin, config) ? origin : null;

    const finish = (status: number) => {
      logger.debug('request', {
        method,
        path: pathname,
        status,
        durationMs: now() - startedAt,
        origin: origin ?? '(none)',
      });
    };

    if (!isAllowedHostHeader(host, config.port)) {
      logger.warn('rejected request with invalid Host header', { host });
      finish(403);
      sendError(res, 403, 'forbidden', 'Invalid Host header.', null);
      return;
    }

    // Health and config are readable without an Origin so a human can open the
    // URL in a browser, but they reveal no secrets.
    const isReadable =
      method === 'GET' && (pathname === BRIDGE_HEALTH_PATH || pathname === BRIDGE_CONFIG_PATH);

    if (!isReadable && !isAllowedOrigin(origin ?? undefined, config)) {
      logger.warn('rejected request from disallowed origin', { origin });
      finish(403);
      sendError(
        res,
        403,
        'forbidden',
        config.extensionIds.length === 0
          ? 'No extension ids are configured. Run the setup script to allowlist this extension.'
          : 'Origin not allowed. Add this extension id to ALLOWED_EXTENSION_IDS.',
        null,
      );
      return;
    }

    if (method === 'OPTIONS') {
      finish(204);
      res.writeHead(204, {
        ...securityHeaders(),
        ...(corsOrigin ? corsHeaders(corsOrigin) : {}),
        Allow: 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    if (isReadable && pathname === BRIDGE_HEALTH_PATH) {
      finish(200);
      sendJson(res, 200, health, corsOrigin);
      return;
    }

    if (isReadable && pathname === BRIDGE_CONFIG_PATH) {
      finish(200);
      sendJson(
        res,
        200,
        {
          version: PRODUCT_VERSION,
          allowedModels: [...config.allowedModels],
          tokenTtlMs: config.tokenTtlMs,
          newSessionTtlMs: config.newSessionTtlMs,
          rateLimitPerMinute: config.rateLimitPerMinute,
        },
        corsOrigin,
      );
      return;
    }

    if (pathname === BRIDGE_PIN_PATH) {
      if (method === 'POST') {
        try {
          const bodyText = await readBody(req);
          const parsed = JSON.parse(bodyText || '{}') as { pin?: boolean; title?: string };
          const shouldPin = parsed.pin !== false;
          const targetTitle =
            typeof parsed.title === 'string' && parsed.title ? parsed.title : 'Gemini Browser Live';
          const safeTitle = targetTitle.replace(/[^a-zA-Z0-9 _-]/g, '');
          if (process.platform === 'win32') {
            const methodToCall = shouldPin ? 'PinTopMost' : 'UnpinTopMost';
            const cmd = `if (Test-Path '${join(SCRIPTS_DIR, 'Win32Pin.dll')}') { Add-Type -Path '${join(SCRIPTS_DIR, 'Win32Pin.dll')}' } else { Add-Type -Path '${join(SCRIPTS_DIR, 'Win32Pin.cs')}' }; [Gemetron.WindowPin]::${methodToCall}('${safeTitle}')`;
            spawn('powershell.exe', ['-NoProfile', '-Command', cmd], {
              stdio: 'ignore',
              windowsHide: true,
            });
          }
          finish(200);
          sendJson(res, 200, { ok: true, pinned: shouldPin, title: safeTitle }, corsOrigin);
        } catch {
          finish(200);
          sendJson(res, 200, { ok: false }, corsOrigin);
        }
        return;
      }
    }

    if (method !== 'POST' || pathname !== BRIDGE_TOKEN_PATH) {
      finish(404);
      sendError(res, 404, 'not_found', 'Not found.', corsOrigin);
      return;
    }

    const ip = req.socket.remoteAddress ?? 'loopback';
    const decision = rateLimiter.check(ip);
    if (!decision.allowed) {
      finish(429);
      sendError(
        res,
        429,
        'rate_limited',
        'Too many token requests. Wait before retrying.',
        corsOrigin,
        { retryAfterMs: decision.retryAfterMs },
      );
      return;
    }

    const suppliedSecret = extractBearer(req.headers.authorization);
    if (!timingSafeEqualString(config.gateSecret, suppliedSecret)) {
      logger.warn('rejected token request with invalid bridge secret');
      finish(401);
      sendError(
        res,
        401,
        'unauthorized',
        'Local bridge secret is missing or incorrect.',
        corsOrigin,
      );
      return;
    }

    if (!config.extensionIds.length) {
      finish(500);
      sendError(res, 500, 'not_configured', 'No extension ids configured.', corsOrigin);
      return;
    }

    const contentType = String(req.headers['content-type'] ?? '');
    if (!contentType.toLowerCase().includes('application/json')) {
      finish(415);
      sendError(res, 415, 'invalid_request', 'Content-Type must be application/json.', corsOrigin);
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      finish(413);
      sendError(res, 413, 'invalid_request', String((error as Error).message), corsOrigin);
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw || '{}');
    } catch {
      finish(400);
      sendError(res, 400, 'invalid_request', 'Body is not valid JSON.', corsOrigin);
      return;
    }

    const validated = TokenRequestSchema.safeParse(parsedBody);
    if (!validated.success) {
      finish(400);
      sendError(res, 400, 'invalid_request', 'A supported "model" field is required.', corsOrigin);
      return;
    }

    try {
      const token = await tokenService.mint(validated.data.model);
      finish(200);
      sendJson(res, 200, token, corsOrigin);
    } catch (error) {
      if (error instanceof TokenServiceError) {
        finish(error.status);
        sendError(res, error.status, error.code, error.message, corsOrigin, {
          ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        });
        return;
      }
      throw error;
    }
  }

  // A hard ceiling on request duration prevents a hung socket from holding the
  // single-threaded bridge hostage.
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  return { server, tokenService, rateLimiter };
}
