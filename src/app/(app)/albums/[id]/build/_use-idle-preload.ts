'use client';

import { useEffect, useRef } from 'react';

/**
 * IDLE-TIME PRELOADING — warm the images for the pages either side of the one being edited, but
 * only when the browser has nothing better to do.
 *
 * The builder shows one spread at a time. Moving to the next one currently means waiting for its
 * photos to fetch and decode. Fetching them during an idle callback removes that wait without
 * competing for anything: `requestIdleCallback` yields to input, layout, paint and — critically —
 * to in-flight uploads, which are the one thing that must never be slowed down for a
 * speculative fetch.
 *
 * SAFEGUARDS, in order of importance:
 *   • `pause` — the caller switches this off while uploads are running, so preloading can never
 *     take bandwidth from a real user-initiated transfer.
 *   • Idle only — no `requestIdleCallback` support (Safari) means no preloading at all, rather
 *     than a `setTimeout` imitation that would fire at the worst possible moment.
 *   • Save-Data / slow link — respected via `navigator.connection`; on a metered connection,
 *     speculatively downloading photos the user may never look at is simply wrong.
 *   • Bounded memory — the set of already-warmed URLs is capped, and the `Image` objects are
 *     released as soon as they settle. The browser's HTTP cache keeps the bytes; we don't.
 */

const MAX_TRACKED = 300;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** True when the connection asks us not to speculate. */
function shouldSkip(): boolean {
  if (typeof navigator === 'undefined') return true;
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!conn) return false; // unknown — proceed, the idle gate is protection enough
  if (conn.saveData) return true;
  return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
}

/**
 * Preload `urls` when idle. Recomputed whenever the key changes (i.e. the user moves pages);
 * anything already warmed is skipped.
 */
export function useIdlePreload(urls: readonly string[], pause: boolean): void {
  const warmedRef = useRef<Set<string>>(new Set());
  // Live images, so a page change can abandon in-flight warm-ups immediately.
  const pendingRef = useRef<Set<HTMLImageElement>>(new Set());

  // A stable key: preloading should re-run when the SET of urls changes, not on every render.
  const key = urls.join('|');

  useEffect(() => {
    if (pause || urls.length === 0 || typeof window === 'undefined') return;
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback !== 'function') return;
    if (shouldSkip()) return;

    const warmed = warmedRef.current;
    const pending = pendingRef.current;

    const handle = idleWindow.requestIdleCallback(
      () => {
        for (const url of urls) {
          if (!url || warmed.has(url)) continue;
          warmed.add(url);
          const img = new Image();
          pending.add(img);
          const done = () => {
            img.onload = null;
            img.onerror = null;
            pending.delete(img);
          };
          img.onload = done;
          img.onerror = done;
          img.decoding = 'async';
          img.src = url;
        }
        // Keep the warmed set bounded — it is a de-dupe guard, not a cache.
        if (warmed.size > MAX_TRACKED) {
          const keep = Array.from(warmed).slice(-Math.floor(MAX_TRACKED / 2));
          warmed.clear();
          for (const u of keep) warmed.add(u);
        }
      },
      { timeout: 2000 },
    );

    return () => {
      idleWindow.cancelIdleCallback?.(handle);
      // Detach listeners from anything still in flight so nothing is retained.
      pending.forEach((img) => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      });
      pending.clear();
    };
    // `key` stands in for the url array's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pause]);

  // Release everything on unmount.
  useEffect(
    () => () => {
      pendingRef.current.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
      pendingRef.current.clear();
      warmedRef.current.clear();
    },
    [],
  );
}
