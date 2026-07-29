/**
 * Fire-and-forget worker wake — THE single client-side nudge primitive.
 *
 * The worker runs as a separate (sleepable) Render service. An inbound request is what
 * wakes it, so a probe IS a wake: `/api/worker/health` both reports readiness and, as a
 * side effect of the request reaching Render, starts the container. That means waking
 * costs one request and does NOT require waiting for the answer.
 *
 * This is the same policy the PDF path already uses server-side (`lib/pdf/generate.ts`
 * → `probeWorker(2500).catch(() => {})`): nudge, never await, let the worker's periodic
 * recovery sweep be the backstop. This module brings the upload path onto it.
 *
 * DEDUPE. Every nudge shares ONE localStorage slot with `WorkerPrewarm`, so a page that
 * pre-warms on mount and then uploads does not fire two wakes, and a 50-file batch fires
 * at most one. The slot is claimed BEFORE the request so a fast second tab or a React
 * remount can't race through. Never throws: private mode / disabled storage just skips.
 *
 * This is NOT a keep-alive — no intervals, no retries, no attempt to hold Render awake.
 */

/** Shared with `WorkerPrewarm` — one key means one wake per window across the whole app. */
export const WORKER_NUDGE_KEY = 'ms:worker:prewarm-at';

/** At most one nudge per 10 minutes, app-wide and cross-tab. */
export const WORKER_NUDGE_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Nudge the worker awake if one hasn't been sent recently. Returns true when a request
 * was actually issued (useful for tests/diagnostics); callers can safely ignore it.
 *
 * Never awaited, never throws, never blocks the caller.
 */
export function nudgeWorker(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const last = Number(localStorage.getItem(WORKER_NUDGE_KEY) ?? '0');
    if (Number.isFinite(last) && Date.now() - last < WORKER_NUDGE_MIN_INTERVAL_MS) return false;
    // Claim the slot BEFORE firing so a remount / second tab can't double-probe.
    localStorage.setItem(WORKER_NUDGE_KEY, String(Date.now()));
    void fetch('/api/worker/health', { cache: 'no-store', keepalive: true }).catch(() => {});
    return true;
  } catch {
    /* localStorage unavailable / private mode — skip silently. */
    return false;
  }
}
