/**
 * ReliabilityEngine — the backbone of human-grade autonomous execution.
 *
 * Provides robust, self-healing primitives that turn fragile browser/desktop
 * operations into reliable workflows:
 *   - Polling with exponential backoff for ports, apps, tabs, and arbitrary conditions
 *   - Retry loops with jittered backoff and per-attempt verification
 *   - Verification helpers that confirm an action truly took effect (not just that it ran)
 *   - Timeout guards that fail fast with descriptive errors instead of hanging
 *
 * Every autonomous step that matters should eventually route through one of these
 * primitives so that transient OS/browser flakiness never becomes a silent failure.
 */

import type { AppManagerService } from './app-manager.js';

/** Options shared by all polling primitives. */
export interface PollOptions {
  /** Polling interval in ms (defaults to 250 for fast paths, 500 otherwise). */
  intervalMs?: number;
  /** Total time to keep trying (defaults to 8000). */
  timeoutMs?: number;
  /** If true, back off exponentially: interval, 2x, 4x ... up to maxIntervalMs. */
  backoff?: boolean;
  /** Cap for exponential backoff (defaults to 1500). */
  maxIntervalMs?: number;
  /** Optional per-attempt progress logger. */
  onTick?: (attempt: number, elapsedMs: number) => void;
}

/** Result of a polling primitive indicating what was found and how long it took. */
export interface PollResult<T> {
  found: boolean;
  value?: T;
  elapsedMs: number;
  attempts: number;
}

/** Retry options with jittered exponential backoff. */
export interface RetryOptions {
  /** Total budget (defaults to 8000). */
  timeoutMs?: number;
  /** Initial delay between retries (defaults to 300). */
  initialDelayMs?: number;
  /** Max delay between retries (defaults to 1500). */
  maxDelayMs?: number;
  /** Whether to multiply delay by 2 each attempt (defaults to true). */
  backoff?: boolean;
  /** Jitter factor 0-1 added as a random fraction of the computed delay. */
  jitter?: number;
  /** Only catch errors that pass this predicate. */
  predicate?: (err: unknown) => boolean;
  /** Per-attempt verification: if supplied, throw here to force another attempt. */
  verify?: (result: unknown) => void | Promise<void>;
}

/** Timeout helper that rejects after the given budget. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

/** Sleep for ms (promisified). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Random jitter as a fraction of delay. */
function jitter(delay: number, factor = 0.3): number {
  return delay * (1 + (Math.random() * 2 - 1) * factor);
}

/**
 * Poll an arbitrary predicate until it returns truthy or the budget expires.
 * Uses jittered exponential backoff so repeated polls don't stampede.
 */
export async function waitForCondition<T>(
  check: () => Promise<T | null | undefined | void>,
  options: PollOptions = {},
): Promise<PollResult<T>> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 8000;
  const useBackoff = options.backoff ?? true;
  const maxIntervalMs = options.maxIntervalMs ?? 1500;
  const onTick = options.onTick;

  const start = Date.now();
  let interval = intervalMs;
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const value = await check();
      if (value) {
        return { found: true, value, elapsedMs: Date.now() - start, attempts };
      }
    } catch {
      // Non-fatal transient errors: keep polling (e.g. tab not ready yet).
      // Log only on failure to aid debugging without spamming.
    }
    await sleep(interval);
    if (useBackoff && interval < maxIntervalMs) {
      interval = Math.min(interval * 2, maxIntervalMs);
    }
    if (onTick) onTick(attempts, Date.now() - start);
  }

  return { found: false, elapsedMs: Date.now() - start, attempts };
}

/**
 * Wait for a TCP port to start responding. Returns true when the port answers.
 */
export async function waitForPort(
  port: number,
  options: Omit<PollOptions, 'intervalMs'> = {},
): Promise<PollResult<boolean>> {
  return waitForCondition(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(400),
        });
        return res.ok ? true : undefined;
      } catch {
        return undefined;
      }
    },
    { intervalMs: 300, backoff: true, maxIntervalMs: 2000, ...options },
  );
}

/** Options for {@link waitForApp}: polling controls plus an optional manager. */
export interface WaitForAppOptions extends PollOptions {
  /** Reuse the caller's AppManagerService instead of creating a throwaway one. */
  appManager?: AppManagerService;
}

/**
 * Wait for an application window to become visible/listed by the app manager.
 * Accepts appName, window title substring, or process name.
 */
export async function waitForApp(
  query: string,
  options: WaitForAppOptions = {},
): Promise<PollResult<{ title: string; hwnd: number; processName: string }>> {
  const { appManager, ...pollOptions } = options;

  // Lazily import the manager so this module stays usable outside Electron and
  // avoids pulling in its Win32/PowerShell dependencies at module load time.
  const manager = appManager ?? new (await import('./app-manager.js')).AppManagerService();

  return waitForCondition(async () => {
    const windows = await manager.listRunningWindows();
    const found = manager.resolveAppWindow(query, windows);
    if (!found) return null;
    return {
      title: found.title,
      hwnd: found.hwnd,
      processName: found.processName,
    };
  }, pollOptions);
}

/**
 * Retry an async function with jittered exponential backoff until it succeeds,
 * the verifier passes, or the budget expires.
 *
 * @returns The successful result, or throws AggregateError of all attempts.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const initialDelayMs = options.initialDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 1500;
  const useBackoff = options.backoff ?? true;
  const jitterFactor = options.jitter ?? 0.3;
  const predicate = options.predicate;
  const verify = options.verify;

  const start = Date.now();
  const failures: unknown[] = [];
  let delay = initialDelayMs;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn();
      if (verify) await verify(result);
      return result;
    } catch (err) {
      if (predicate && !predicate(err)) throw err;
      failures.push(err);
      if (Date.now() - start >= timeoutMs) break;
      await sleep(jitter(delay, jitterFactor));
      if (useBackoff && delay < maxDelayMs) {
        delay = Math.min(delay * 2, maxDelayMs);
      }
    }
  }

  const agg = new AggregateError(failures, `All ${failures.length} attempts failed`);
  if (failures.length === 1) {
    return Promise.reject(failures[0]);
  }
  return Promise.reject(agg);
}

/**
 * Verify that an action produced a durable effect, polling a predicate.
 * Returns { ok: true, elapsedMs, attempts } or throws a descriptive TimeoutError.
 */
export async function verifyAction<T>(
  act: () => Promise<T>,
  verify: (result: T) => Promise<boolean | unknown>,
  options: PollOptions & { message?: string } = {},
): Promise<{ ok: true; result: T; elapsedMs: number; attempts: number }> {
  const intervalMs = options.intervalMs ?? 300;
  const timeoutMs = options.timeoutMs ?? 10000;
  const label = options.message ?? 'action verification';

  let result: T | null = null;
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts++;
    result = await act();
    const verified = await verify(result);
    if (verified) {
      return { ok: true, result, elapsedMs: Date.now() - start, attempts };
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Verification failed for ${label} after ${attempts} attempts (${Date.now() - start}ms). Last result: ${JSON.stringify(
      result,
    )}`,
  );
}

/** Human-friendly delay builder for orchestrating multi-step workflows. */
export async function humanDelay(options?: { seconds?: number }): Promise<void> {
  const secs = Math.max(1, options?.seconds ?? 2);
  await sleep(secs * 1000);
}

/**
 * Wait for a Chrome CDP tab to reach a ready state (navigated + DOM available).
 */
export async function waitForTabReady(
  cdpUrl: string | undefined,
  options: Omit<PollOptions, 'backoff' | 'maxIntervalMs'> = {},
): Promise<PollResult<{ tabId: string; ready: boolean }>> {
  if (!cdpUrl) {
    return { found: false, elapsedMs: 0, attempts: 0 };
  }

  return waitForCondition(
    async () => {
      try {
        const res = await fetch(cdpUrl.replace(/\/$/, ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 999, method: 'Page.getFrameTree' }),
          signal: AbortSignal.timeout(600),
        });
        if (!res.ok) return null;
        const body = await res.json();
        if (body.error) return null;
        return { tabId: cdpUrl.split('/').pop() || '', ready: true };
      } catch {
        return null;
      }
    },
    { intervalMs: 400, ...options },
  );
}
