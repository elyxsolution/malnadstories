'use client';

import { useEffect } from 'react';
import { nudgeWorker } from './nudge';

/**
 * Lightweight, opportunistic pre-warm (Phase G, Part 7).
 *
 * Mounted on pages where a worker-dependent action is LIKELY soon (dashboard, album
 * creation, builder). On mount it fires AT MOST ONE health probe — and only if the
 * last one was over 10 minutes ago (tracked in localStorage across navigations/tabs).
 *
 * The dedupe + fetch now live in `nudgeWorker()` so the UPLOADER shares the SAME slot:
 * pre-warming on builder mount and then starting an upload can never produce two wakes.
 * Behaviour here is otherwise unchanged.
 *
 * This is purely an optimization: if the user is actively building, the worker is
 * probably already awake by the time they upload / generate a PDF. It is NOT a
 * keep-alive — no intervals, no cron, no attempt to hold Render awake.
 */
export default function WorkerPrewarm() {
  useEffect(() => {
    nudgeWorker();
  }, []);

  return null;
}
