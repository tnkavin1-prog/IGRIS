/** Authentication and origin checks for the loopback bridge. */
import crypto from 'node:crypto';
import type { BridgeConfig } from './config.js';

/** Constant-time comparison that does not leak length through early exit. */
export function timingSafeEqualString(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const a = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const b = crypto.createHash('sha256').update(supplied, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function extractBearer(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim();
}

/**
 * Only these origins may call the bridge:
 *  - the installed extension (by its stable id),
 *  - loopback pages (for diagnostics),
 *  - explicitly configured extras.
 */
export function isAllowedOrigin(origin: string | undefined, config: BridgeConfig): boolean {
  if (!origin) return false;
  if (origin === 'null') return false;

  const extensionMatch = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (extensionMatch) {
    const id = extensionMatch[1];
    // An empty allowlist means setup is incomplete; refuse rather than allow-all.
    return Boolean(id && config.extensionIds.includes(id));
  }

  const loopback = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]);
  if (loopback.has(origin)) return true;

  return config.extraOrigins.includes(origin);
}

/**
 * DNS-rebinding defence: the Host header must name loopback on our port.
 * Anything else is rejected even if the TCP connection is local.
 */
export function isAllowedHostHeader(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    normalized === `127.0.0.1:${port}` ||
    normalized === `localhost:${port}` ||
    normalized === `[::1]:${port}`
  );
}

export function originFromExtensionId(id: string): string {
  return `chrome-extension://${id}`;
}
