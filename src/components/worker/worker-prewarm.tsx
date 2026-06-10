'use client';

import { useEffect } from 'react';

/**
 * Lightweight, opportunistic pre-warm (Phase G, Part 7).
 *
 * Mounted on pages where a worker-dependent action is LIKELY soon (dashboard, album
 * creation, builder). On mount it fires AT MOST ONE health probe — and only if the
 * last one was over 10 minutes ago (tracked in localStorage across navigations/tabs).
 *
 * This is purely an optimization: if the user is actively building, the worker is
 * probably already awake by the time they upload / generate a PDF, so the wake-up
 * modal never appears. It is NOT a keep-alive — no intervals, no cron, no attempt to
 * hold Render awake. The readiness gate remains the source of truth.
 */

const KEY = 'ms:worker:prewarm-at';
const MIN_INTERVAL_MS = 10 * 60 * 1000; // at most once per 10 minutes

export default function WorkerPrewarm() {
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(KEY) ?? '0');
      if (Number.isFinite(last) && Date.now() - last < MIN_INTERVAL_MS) return;
      // Claim the slot BEFORE firing so a fast remount/second tab can't double-probe.
      localStorage.setItem(KEY, String(Date.now()));
      void fetch('/api/worker/health', { cache: 'no-store', keepalive: true }).catch(() => {});
    } catch {
      /* localStorage unavailable / private mode — skip silently. */
    }
  }, []);

  return null;
}
