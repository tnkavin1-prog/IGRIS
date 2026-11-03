/** Sliding-window rate limiter with an injectable clock (unit-testable). */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 1_000,
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key) ?? [];
    const recent = existing.filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Bound memory: drop the least recently used key when the map grows.
    if (this.hits.size > this.maxKeys) {
      const firstKey = this.hits.keys().next().value;
      if (firstKey !== undefined && firstKey !== key) this.hits.delete(firstKey);
    }

    return { allowed: true, remaining: Math.max(0, this.limit - recent.length), retryAfterMs: 0 };
  }

  reset(): void {
    this.hits.clear();
  }
}
