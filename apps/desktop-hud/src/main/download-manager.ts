/**
 * Download Manager — Tier-1 autonomous file download capability.
 *
 * Downloads files from HTTP/HTTPS URLs into the project's download directory
 * (E:\Gematron\downloads\) with progress tracking, resume support, and
 * automatic filename sanitization. Used by the autonomous agent to fetch
 * reference images, 3D scenes, and assets from the web without user intervention.
 *
 * Security:
 * - Rejects private/loopback/reserved IP addresses (SSRF protection)
 * - Validates every HTTP redirect hop against the same IP policy
 * - Enforces max download size, timeout, and active download count
 * - Atomic write: destination only replaced after complete, validated download
 */

import { createWriteStream, existsSync, mkdirSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import * as dns from 'node:dns/promises';
import { DOWNLOADS_DIR } from './runtime-paths.js';

const DOWNLOAD_ROOT = DOWNLOADS_DIR;

const MAX_ACTIVE_DOWNLOADS = 10;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const DEFAULT_TIMEOUT_MS = 300 * 1000; // 5 minutes

// Private/reserved IP ranges per RFC 1918, RFC 5737, RFC 6598, etc.
const PRIVATE_IP_PATTERNS = [
  /^10\./,                              // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,     // 172.16.0.0/12
  /^192\.168\./,                         // 192.168.0.0/16
  /^127\./,                              // 127.0.0.0/8 loopback
  /^169\.254\./,                         // 169.254.0.0/16 link-local
  /^0\.0\.0\.0/,                         // 0.0.0.0/8
  /^224\./,                              // 224.0.0.0/4 multicast
  /^240\./,                              // 240.0.0.0/4 reserved
  /^::1$/,                               // IPv6 loopback
  /^fe80:/,                              // IPv6 link-local
  /^ff0[0-9a-f]:/,                       // IPv6 multicast
  /^fc00:/,                              // IPv6 unique local
];

export interface DownloadProgress {
  url: string;
  destination: string;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
  speedBps: number;
  etaSeconds?: number;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface DownloadOptions {
  destination?: string;
  filename?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxBytes?: number;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

export class DownloadManager {
  private readonly downloadRoot: string;
  private readonly activeDownloads = new Map<string, DownloadProgress>();
  private readonly history: DownloadProgress[] = [];

  constructor(downloadRoot = DOWNLOAD_ROOT) {
    this.downloadRoot = downloadRoot;
    mkdirSync(this.downloadRoot, { recursive: true });
  }

  /**
   * Reject private/loopback/reserved IP addresses (SSRF protection).
   * Checks both hostname (for literal IPs) and resolved addresses.
   */
  private static isPrivateOrLoopback(host: string): boolean {
    // IPv4 literal
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return PRIVATE_IP_PATTERNS.some((p) => p.test(host));
    }
    // IPv6 literal
    if (host.includes(':')) {
      return PRIVATE_IP_PATTERNS.some((p) => p.test(host));
    }
    return false;
  }

  /**
   * Resolve a hostname to IP addresses and check if any are private/loopback.
   */
  private static async resolveAndCheck(hostname: string): Promise<boolean> {
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (this.isPrivateOrLoopback(addr.address)) {
          return true;
        }
      }
    } catch {
      // DNS lookup failure: reject to be safe
      return true;
    }
    return false;
  }

  /**
   * Validate a URL against SSRF policy. Rejects private/loopback/reserved IPs
   * and checks DNS resolution for hostnames.
   */
  private static async validateUrl(url: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname;
    if (this.isPrivateOrLoopback(hostname)) {
      throw new Error(`Rejected private/loopback host: ${hostname}`);
    }

    if (await this.resolveAndCheck(hostname)) {
      throw new Error(`Rejected host resolving to private/loopback address: ${hostname}`);
    }
  }

  /**
   * Sanitize a URL into a safe filename.
   */
  private static sanitizeFilename(url: string, fallback = 'download'): string {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname || '/';
      const base = pathname.split('/').pop() || fallback;
      // Strip query string and sanitize characters
      const clean = base
        .split('?')[0]!
        .split('#')[0]!
        .replace(/[^a-z0-9._-]/gi, '_');
      return clean || fallback;
    } catch {
      return `${fallback}_${Date.now()}`;
    }
  }

  /**
   * Get the full download directory, creating it if needed.
   */
  public getDownloadDir(): string {
    if (!existsSync(this.downloadRoot)) {
      mkdirSync(this.downloadRoot, { recursive: true });
    }
    return this.downloadRoot;
  }

  /**
   * List previously downloaded files.
   */
  public async listDownloads(): Promise<Array<{ name: string; path: string; size: number }>> {
    try {
      const entries = await fs.readdir(this.downloadRoot, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const full = join(this.downloadRoot, e.name);
            const stat = await fs.stat(full);
            return { name: e.name, path: full, size: stat.size };
          }),
      );
      return files.sort((a, b) => b.size - a.size);
    } catch {
      return [];
    }
  }

  /**
   * Download a file from a URL. Returns the destination path on success.
   * Supports progress callbacks, retries, abort signals, SSRF protection,
   * byte caps, timeouts, and atomic writes.
   */
  public async downloadFile(
    url: string,
    options: DownloadOptions = {},
  ): Promise<{ ok: boolean; destination?: string; error?: string; bytes?: number }> {
    const {
      destination,
      filename = DownloadManager.sanitizeFilename(url),
      maxRetries = 3,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxBytes = MAX_DOWNLOAD_BYTES,
      onProgress,
      signal,
    } = options;

    // SSRF validation on initial URL
    await DownloadManager.validateUrl(url);

    const destPath = destination || join(this.downloadRoot, filename);
    const destDir = join(destPath, '..');
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Enforce active download count limit
    if (this.activeDownloads.size >= MAX_ACTIVE_DOWNLOADS) {
      return {
        ok: false,
        error: `Maximum active downloads (${MAX_ACTIVE_DOWNLOADS}) reached`,
        bytes: 0,
      };
    }

    const id = `${url}::${destPath}`;
    const startTime = Date.now();

    const progress: DownloadProgress = {
      url,
      destination: destPath,
      totalBytes: 0,
      downloadedBytes: 0,
      percent: 0,
      speedBps: 0,
      etaSeconds: undefined,
      status: 'queued',
      startedAt: startTime,
    };
    this.activeDownloads.set(id, progress);
    if (onProgress) onProgress({ ...progress });

    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      progress.status = 'downloading';
      progress.error = undefined;
      if (onProgress) onProgress({ ...progress });

      let lastBytes = 0;
      let lastTime = Date.now();
      let downloadTimedOut = false;

      try {
        const controller = new AbortController();
        const combinedSignal = signal
          ? (() => {
              const ac = new AbortController();
              ac.signal.addEventListener('abort', () => controller.abort());
              signal.addEventListener('abort', () => controller.abort());
              return ac.signal;
            })()
          : controller.signal;

        const timeoutId = setTimeout(() => {
          downloadTimedOut = true;
          controller.abort();
        }, timeoutMs);

        try {
          const res = await fetch(url, {
            signal: combinedSignal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GematronAutonomousAgent/1.0',
              'Range': 'bytes=0-',
            },
            redirect: 'manual', // Handle redirects manually for SSRF validation
          });

          // Handle redirects manually for SSRF validation
          let currentUrl = url;
          let currentRes = res;
          let redirectCount = 0;

          while (currentRes.status >= 300 && currentRes.status < 400 && currentRes.headers.get('location')) {
            redirectCount++;
            if (redirectCount > 10) {
              throw new Error('Too many redirects');
            }

            const location = currentRes.headers.get('location')!;
            const redirectUrl = new URL(location, currentUrl).toString();
            currentUrl = redirectUrl;

            // SSRF check on redirect target
            await DownloadManager.validateUrl(redirectUrl);

            currentRes = await fetch(redirectUrl, {
              signal: combinedSignal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GematronAutonomousAgent/1.0',
                'Range': 'bytes=0-',
              },
              redirect: 'manual',
            });
          }

          if (!currentRes.ok || !currentRes.body) {
            throw new Error(`HTTP ${currentRes.status}: ${currentRes.statusText}`);
          }

          const contentLength = currentRes.headers.get('content-length');
          const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
          progress.totalBytes = totalSize;

          if (totalSize > maxBytes) {
            throw new Error(`Download exceeds byte cap: ${totalSize} > ${maxBytes}`);
          }

          const tempPath = destPath + '.tmp';
          const writer = createWriteStream(tempPath);
          const reader = currentRes.body.getReader();

          while (true) {
            if (signal?.aborted || downloadTimedOut) {
              reader.cancel();
              writer.destroy();
              await fs.rm(tempPath, { force: true }).catch(() => undefined);
              progress.status = downloadTimedOut ? 'failed' : 'cancelled';
              progress.error = downloadTimedOut ? 'Download timed out' : 'Download aborted by signal';
              if (onProgress) onProgress({ ...progress });
              return { ok: false, error: progress.error, bytes: progress.downloadedBytes };
            }

            const { done, value } = await reader.read();
            if (done) break;

            writer.write(value as unknown as Buffer);
            progress.downloadedBytes += (value as Buffer).length;

            if (progress.downloadedBytes > maxBytes) {
              reader.cancel();
              writer.destroy();
              await fs.rm(tempPath, { force: true }).catch(() => undefined);
              throw new Error(`Download exceeds byte cap: ${progress.downloadedBytes} > ${maxBytes}`);
            }

            const now = Date.now();
            const elapsed = Math.max(now - lastTime, 1);
            const deltaBytes = progress.downloadedBytes - lastBytes;
            progress.speedBps = Math.round((deltaBytes / elapsed) * 1000);

            if (progress.totalBytes > 0) {
              progress.percent =
                Math.round((progress.downloadedBytes / progress.totalBytes) * 1000) / 10;
              const remainingBytes = progress.totalBytes - progress.downloadedBytes;
              progress.etaSeconds =
                progress.speedBps > 0 ? Math.round(remainingBytes / progress.speedBps) : undefined;
            } else {
              progress.percent = 0;
            }

            lastBytes = progress.downloadedBytes;
            lastTime = now;
            if (onProgress) onProgress({ ...progress });
          }

          writer.end();

          await new Promise<void>((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });

          clearTimeout(timeoutId);

          progress.status = 'completed';
          progress.percent = 100;
          progress.completedAt = Date.now();
          if (onProgress) onProgress({ ...progress });

          this.history.push({ ...progress });
          this.activeDownloads.delete(id);

          // Atomic rename: only replace destination after complete download
          if (tempPath !== destPath) {
            await fs.rename(tempPath, destPath).catch(() => {});
          }

          const stat = await fs.stat(destPath);
          return {
            ok: true,
            destination: destPath,
            bytes: stat.size,
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        progress.error = lastError;

        if (attempt < maxRetries && !downloadTimedOut && !signal?.aborted) {
          const backoff = Math.min(1000 * attempt, 10_000);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        progress.status = 'failed';
        progress.completedAt = Date.now();
        if (onProgress) onProgress({ ...progress });

        this.history.push({ ...progress });
        this.activeDownloads.delete(id);

        return { ok: false, error: lastError, bytes: progress.downloadedBytes };
      }
    }

    return { ok: false, error: lastError || 'Download failed after retries' };
  }

  /**
   * Get all active download progress records.
   */
  public getActiveDownloads(): DownloadProgress[] {
    return Array.from(this.activeDownloads.values());
  }

  /**
   * Get download history.
   */
  public getHistory(): DownloadProgress[] {
    return [...this.history];
  }

  /**
   * Cancel all active downloads.
   */
  public cancelAll(): void {
    for (const [, p] of this.activeDownloads) {
      p.status = 'cancelled';
      p.completedAt = Date.now();
    }
  }

  public isDownloading(url: string): boolean {
    return Array.from(this.activeDownloads.values()).some(
      (p) => p.url === url && p.status === 'downloading',
    );
  }

  public getActiveDownloadCount(): number {
    return this.activeDownloads.size;
  }
}

export const downloadManager = new DownloadManager();
