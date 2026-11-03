import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../../../apps/local-bridge/src/rate-limit.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows exactly the configured number of requests per window', () => {
    const now = 1_000;
    const limiter = new SlidingWindowRateLimiter(3, 60_000, () => now);

    expect(limiter.check('ip')).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.check('ip')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check('ip')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check('ip')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('reports a retry delay based on the oldest request in the window', () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => now);

    limiter.check('ip');
    now = 16_000;
    const decision = limiter.check('ip');

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterMs).toBe(45_000);
  });

  it('slides the window instead of resetting it in fixed buckets', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 10_000, () => now);

    expect(limiter.check('ip').allowed).toBe(true); // t=0
    now = 5_000;
    expect(limiter.check('ip').allowed).toBe(true); // t=5s
    now = 10_001;
    // The t=0 hit has expired, so one slot is free again.
    expect(limiter.check('ip').allowed).toBe(true);
    // The t=5s hit is still inside the window, so the limiter is full again.
    expect(limiter.check('ip').allowed).toBe(false);
  });

  it('isolates keys from one another', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 0);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('resets cleanly', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => 0);
    limiter.check('ip');
    expect(limiter.check('ip').allowed).toBe(false);
    limiter.reset();
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('bounds memory by evicting the oldest key', () => {
    const limiter = new SlidingWindowRateLimiter(5, 60_000, () => 0, 2);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('c').allowed).toBe(true);
    // 'a' was evicted, so it starts fresh; 'c' is the newest and remains.
    expect(limiter.check('a').allowed).toBe(true);
  });
});
