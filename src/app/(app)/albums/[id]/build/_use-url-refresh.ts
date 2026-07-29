'use client';

import { useCallback, useEffect, useRef } from 'react';
import { now, record } from '@/lib/perf/metrics';
import type { PhotoRow, PolledPhoto } from './_use-photo-poll';

/**
 * SIGNED-URL REFRESH.
 *
 * R2 objects are private; every image is a presigned GET that expires after **10 minutes**
 * (`presignGet`'s default). Phase 2 made URLs sticky — once a photo has one we never replace it —
 * which fixed a re-download storm but left an obvious consequence: sit in the builder for more
 * than ten minutes and the images 403.
 *
 * WHAT "REFRESH ONLY WHAT'S NEEDED" CAN MEAN HERE. The only read endpoint is
 * `GET /api/photos?albumId=`, which returns the whole album with fresh URLs, and the backend is
 * off-limits. So the fetch is unavoidably album-wide — but what we DO with the response is
 * strictly targeted: new URLs are applied only to photos whose URL is actually near expiry or
 * has actually failed. Every other photo keeps its existing URL string, so its `<img>` src never
 * changes and the browser never re-downloads it. That is the property that matters; a single
 * JSON round trip is not what made the old behaviour expensive.
 *
 * TWO TRIGGERS, DELIBERATELY:
 *   • PROACTIVE — a sweep runs on a slow timer and refreshes URLs older than 80% of the TTL,
 *     so in the common case a URL is replaced before anything breaks and the user sees nothing.
 *   • REACTIVE — an `<img>` that fails reports it (`onLoadError`), and that photo is refreshed
 *     immediately. This is the safety net for clock skew, a suspended laptop, or a tab restored
 *     from bfcache, where "age" was never measured accurately in the first place.
 *
 * Refreshes are coalesced: concurrent requests share one in-flight fetch, and a hard floor
 * between sweeps means a wall of failing images can't turn into a request storm.
 */

/** Matches `presignGet`'s default expiry. */
export const SIGNED_URL_TTL_MS = 10 * 60 * 1000;
/** Refresh at 80% of life — comfortably before expiry, without churning. */
const REFRESH_AT_MS = SIGNED_URL_TTL_MS * 0.8;
/** Never fetch more often than this, whatever asks. */
const MIN_INTERVAL_MS = 30_000;
/** How often the proactive sweep looks. Cheap: it usually decides to do nothing. */
const SWEEP_INTERVAL_MS = 60_000;

export type UrlRefreshOptions = {
  albumId: string | null;
  /** Live read of the photo list (ref-backed — must not change identity per render). */
  getPhotos: () => readonly PolledPhoto[];
  /** Apply refreshed URLs. Only ever called with photos that genuinely needed them. */
  apply: (rows: PhotoRow[]) => void;
};

export function useUrlRefresh({ albumId, getPhotos, apply }: UrlRefreshOptions) {
  const optionsRef = useRef({ getPhotos, apply });
  useEffect(() => {
    optionsRef.current = { getPhotos, apply };
  });

  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchRef = useRef(0);
  /** Photos an <img> reported as broken — always refreshed, regardless of measured age. */
  const forcedRef = useRef<Set<string>>(new Set());

  const run = useCallback(
    async () => {
      if (!albumId) return;
      if (inFlightRef.current) return inFlightRef.current;

      const elapsed = now() - lastFetchRef.current;
      if (lastFetchRef.current > 0 && elapsed < MIN_INTERVAL_MS) return;

      const photos = optionsRef.current.getPhotos();
      const forced = forcedRef.current;
      const stale = new Set<string>(forced);
      const cutoff = Date.now() - REFRESH_AT_MS;
      for (const p of photos) {
        // Only photos that HAVE a URL can have a stale one. A pending photo has nothing to
        // refresh, and a blob preview never expires.
        if (!p.url && !p.thumbUrl) continue;
        if (p.urlIssuedAt !== undefined && p.urlIssuedAt !== null && p.urlIssuedAt <= cutoff) stale.add(p.id);
      }
      // Nothing aged out and nothing broke — the sweep's usual outcome.
      if (stale.size === 0) return;

      const started = now();
      const task = (async () => {
        try {
          const res = await fetch(`/api/photos?albumId=${albumId}`);
          if (!res.ok) return;
          const body = (await res.json()) as { photos: PhotoRow[] };
          // THE targeted part: discard every row we didn't ask about, so untouched photos keep
          // their current src and are never re-fetched by the browser.
          const rows = (body.photos ?? []).filter((r) => stale.has(r.id) && (r.url || r.thumbUrl));
          if (rows.length > 0) optionsRef.current.apply(rows);
          forced.clear();
          record('url.refresh', now() - started);
        } catch {
          /* transient — the next sweep tries again */
        } finally {
          lastFetchRef.current = now();
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = task;
      return task;
    },
    [albumId],
  );

  /** Report a failed image. Refreshes that photo (coalesced with any other failures). */
  const reportFailure = useCallback(
    (photoId: string) => {
      forcedRef.current.add(photoId);
      void run();
    },
    [run],
  );

  useEffect(() => {
    if (!albumId) return;
    const timer = setInterval(() => void run(), SWEEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [albumId, run]);

  return { reportFailure };
}
