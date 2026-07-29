'use client';

import { useEffect, useRef } from 'react';
import { usePreviewHandoff } from './_use-preview-handoff';

/**
 * THE shared photo poll — one implementation for the builder and the creation wizard.
 *
 * It owns three things the two surfaces used to duplicate (and one of them got wrong):
 *
 * 1. RECONCILIATION. `GET /api/photos` re-signs every URL on every read, so a naive
 *    `url !== url` comparison is ALWAYS true and the old code rewrote every photo's `src`
 *    every 3 seconds — making the browser re-download every visible image, forever, for as
 *    long as any single upload was processing. `photoRowChanged` therefore ignores a mere
 *    re-signature and reports a change only for things that actually matter: status, gaining
 *    a URL you didn't have, or metadata. When nothing changed, no state is set at all — no
 *    render, no refetch. `mergePhotoRow` then keeps the URL already in hand ("first
 *    non-empty wins"), so a stable photo's `src` string never churns.
 *
 * 2. PROGRESSIVE CADENCE. A `setTimeout` chain (not `setInterval`) so the delay can grow:
 *    3s for the first minute, 5s to three minutes, 8s after. Fast when the user is waiting,
 *    quiet when something is genuinely slow. The clock resets whenever new work arrives.
 *
 * 3. THE PREVIEW HANDOFF (Phase 1), composed in — rows still showing a local blob are held
 *    back until their processed image has actually decoded.
 *
 * BACKEND UNCHANGED: same endpoint, same query, same response shape. Only the client's
 * read cadence and its diffing changed.
 */

/** One row as returned by `GET /api/photos?albumId=`. */
export type PhotoRow = {
  id: string;
  status: 'pending' | 'ready' | 'rejected';
  url: string;
  thumbUrl: string;
  takenAt: string | null;
  width?: number | null;
  height?: number | null;
};

/** The subset of a local photo the poll compares against. */
export type PolledPhoto = {
  id: string;
  status: string;
  url: string;
  thumbUrl: string;
  takenAt: string | null;
  width?: number | null;
  height?: number | null;
  localUrl?: string | null;
  /** When the current signed URL was minted — drives expiry-aware refresh (Phase 5). */
  urlIssuedAt?: number | null;
};

// ── cadence ────────────────────────────────────────────────────────────────────────

export const POLL_STEPS: readonly { untilMs: number; everyMs: number }[] = [
  { untilMs: 60_000, everyMs: 3000 },
  { untilMs: 180_000, everyMs: 5000 },
  { untilMs: Number.POSITIVE_INFINITY, everyMs: 8000 },
];

/** Delay before the next tick, given how long this run of work has been going. */
export function pollDelay(elapsedMs: number): number {
  for (const step of POLL_STEPS) {
    if (elapsedMs < step.untilMs) return step.everyMs;
  }
  return POLL_STEPS[POLL_STEPS.length - 1].everyMs;
}

// ── reconciliation ─────────────────────────────────────────────────────────────────

/**
 * Did anything MEANINGFUL change? A freshly-signed URL for a photo we can already display
 * is not a change — that is the whole point.
 */
export function photoRowChanged(current: PolledPhoto | undefined, row: PhotoRow): boolean {
  if (!current) return true; // unknown id — the caller may want to adopt it
  if (current.status !== row.status) return true;
  if (!current.url && !!row.url) return true; // gained the sanitized master
  if (!current.thumbUrl && !!row.thumbUrl) return true; // gained the thumbnail
  if (current.takenAt !== row.takenAt) return true; // EXIF capture date landed
  if ((current.width ?? null) !== (row.width ?? null)) return true;
  if ((current.height ?? null) !== (row.height ?? null)) return true;
  return false;
}

/**
 * The fields to apply for a changed row. URLs are STICKY — the first non-empty one wins — so an
 * image the browser already has is never re-pointed at an equivalent signed URL.
 *
 * `force` is the ONE exception, used by the expiry-aware refresh (Phase 5): it deliberately
 * adopts the newer URL for a photo whose current one is about to expire (or has just failed).
 * Stickiness exists to prevent pointless re-downloads, not to hold on to a dead URL.
 *
 * `urlIssuedAt` is stamped whenever a URL is actually adopted, which is what makes age — and
 * therefore "does this need refreshing?" — knowable at all.
 */
export function mergePhotoRow(current: PolledPhoto | undefined, row: PhotoRow, force = false) {
  const takeNew = force || !current?.url;
  const takeNewThumb = force || !current?.thumbUrl;
  const url = takeNew ? row.url || current?.url || '' : current?.url || '';
  const thumbUrl = takeNewThumb ? row.thumbUrl || current?.thumbUrl || '' : current?.thumbUrl || '';
  const adopted = (takeNew && !!row.url) || (takeNewThumb && !!row.thumbUrl);
  return {
    status: row.status,
    url,
    thumbUrl,
    takenAt: row.takenAt,
    width: row.width ?? null,
    height: row.height ?? null,
    urlIssuedAt: adopted ? Date.now() : (current?.urlIssuedAt ?? null),
  };
}

// ── the hook ───────────────────────────────────────────────────────────────────────

export type UsePhotoPollOptions = {
  albumId: string | null;
  /** Poll only while there is something to learn. */
  enabled: boolean;
  /** Run a tick immediately on start (the wizard does; the builder waits one interval). */
  immediate?: boolean;
  /**
   * Any monotonic measure of outstanding work — the cadence resets when it INCREASES, so a
   * new upload during a slow batch gets fast polling again.
   */
  resetKey: number;
  /** Live read of the caller's photo list (ref-backed; must not change identity per render). */
  getPhotos: () => readonly PolledPhoto[];
  /** Apply rows that genuinely changed. Never called with an empty list. */
  apply: (rows: PhotoRow[]) => void;
  /** Commit a deferred blob→processed swap. `loaded` false ⇒ keep the blob. */
  applyHandoff: (row: PhotoRow, loaded: boolean) => void;
};

export function usePhotoPoll(options: UsePhotoPollOptions): void {
  const handoff = usePreviewHandoff<PhotoRow>();

  // Latest options without re-subscribing the timer chain.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const { albumId, enabled, immediate = false, resetKey } = options;

  // Cadence clock. Resets when new work arrives so a fresh upload is polled fast again.
  const startedAt = useRef(Date.now());
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey > prevResetKey.current) startedAt.current = Date.now();
    prevResetKey.current = resetKey;
  }, [resetKey]);

  useEffect(() => {
    if (!enabled || !albumId) return;
    startedAt.current = Date.now(); // a new run of work always starts fast
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const localUrlOf = (id: string) =>
      optionsRef.current.getPhotos().find((p) => p.id === id)?.localUrl ?? null;

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(tick, pollDelay(Date.now() - startedAt.current));
    };

    const tick = async () => {
      try {
        const res = await fetch(`/api/photos?albumId=${albumId}`);
        if (!res.ok || !active) return;
        const body = (await res.json()) as { photos: PhotoRow[] };
        if (!active) return;

        const rows = body.photos ?? [];
        // Rows still showing a local blob wait for their processed image to decode.
        const { handoffs, deferred } = handoff.partition(rows, localUrlOf);

        const current = new Map(optionsRef.current.getPhotos().map((p) => [p.id, p]));
        const changed = rows.filter((r) => !deferred.has(r.id) && photoRowChanged(current.get(r.id), r));
        // The quiet path: nothing moved, so no setState, no re-render, no image refetch.
        if (changed.length > 0) optionsRef.current.apply(changed);

        handoff.settle(handoffs, localUrlOf, (row, loaded) => optionsRef.current.applyHandoff(row, loaded), () => active);
      } catch {
        /* transient — the next tick retries */
      } finally {
        schedule();
      }
    };

    if (immediate) void tick();
    else schedule();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
    // `handoff` is ref-backed and stable.
  }, [albumId, enabled, immediate, handoff]);
}
