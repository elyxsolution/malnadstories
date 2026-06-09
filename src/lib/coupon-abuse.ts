import 'server-only';

/**
 * Coupon brute-force defence (Refinement 4) — a second layer on top of the generic
 * per-user rate limit. Only INVALID coupon attempts accrue here; a valid attempt
 * clears the counter, so legitimate users (who enter their one real code) can never
 * be throttled. After MAX_FAILURES invalid tries inside WINDOW_MS, the user is put in
 * a COOLDOWN during which all coupon attempts are refused.
 *
 * CAVEAT (same as rate-limit.ts): in-memory + per-process. Move to a shared store
 * (Redis/Postgres) before any multi-instance deploy.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000; // window to accumulate failures
const COOLDOWN_MS = 10 * 60_000; // lockout duration once the threshold is hit

type Rec = { failures: number; windowResetAt: number; lockedUntil: number };
const records = new Map<string, Rec>();

let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  records.forEach((r, k) => {
    if (r.lockedUntil <= now && r.windowResetAt <= now) records.delete(k);
  });
}

/** Is this key currently in cooldown? Check BEFORE validating a coupon. */
export function isCouponLocked(key: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const r = records.get(key);
  if (r && r.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((r.lockedUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** Record one INVALID coupon attempt; trips a cooldown at the threshold. */
export function recordCouponFailure(key: string): void {
  const now = Date.now();
  sweep(now);
  const r = records.get(key);
  if (!r || now >= r.windowResetAt) {
    records.set(key, { failures: 1, windowResetAt: now + WINDOW_MS, lockedUntil: 0 });
    return;
  }
  r.failures += 1;
  if (r.failures >= MAX_FAILURES) {
    r.lockedUntil = now + COOLDOWN_MS;
    r.windowResetAt = now + COOLDOWN_MS;
    r.failures = 0;
  }
}

/** Clear all failures for a key (called on a successful validation). */
export function clearCouponFailures(key: string): void {
  records.delete(key);
}
