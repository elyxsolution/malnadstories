import 'server-only';

/**
 * Minimal in-memory fixed-window rate limiter for the money endpoints
 * (order creation, webhook). A module-level Map keyed by an arbitrary string
 * (user id, client IP). No external dependency.
 *
 * CAVEAT (mirrors the pg-boss serverless note in queue.ts): this state is
 * per-process and resets on restart, so it only protects a single long-lived
 * instance — fine for the current single-server dev/prod setup. Before any
 * multi-instance deploy, move this to a shared store (Postgres/Upstash).
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Returns { ok } and, when limited, the seconds until the window resets.
 * `ok: false` means the caller exceeded `limit` requests within `windowMs`.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

// Opportunistic cleanup so the Map doesn't grow unbounded across many keys.
// Cheap and runs at most once per call window.
let lastSweep = 0;
export function sweepRateLimits(now = Date.now()): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  buckets.forEach((b, k) => {
    if (now >= b.resetAt) buckets.delete(k);
  });
}
