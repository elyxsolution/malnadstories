'use client';

import { useEffect, useState } from 'react';

/**
 * ONE shared low-frequency clock for every "how long has this been going?" label.
 *
 * The naive version gives each badge its own `setInterval`; a 100-photo batch then runs 100
 * timers and schedules 100 independent re-renders. Here a single module-level interval ticks
 * while at least one subscriber is listening, and stops the moment the last one leaves — so the
 * cost is one timer regardless of how many photos are on screen, and zero when nothing is
 * processing.
 *
 * 5s resolution is deliberate: the escalation thresholds are 15s and 45s, so a faster clock
 * would buy nothing but re-renders.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (timer === null) {
    timer = setInterval(() => {
      listeners.forEach((l) => l());
    }, 5000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Re-render on the shared clock while `enabled`. Returns the current time in ms, so callers can
 * derive an elapsed duration without holding their own state.
 */
export function useSlowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now()); // fresh reading on (re-)enable, don't wait a full period
    return subscribe(() => setNow(Date.now()));
  }, [enabled]);
  return now;
}
