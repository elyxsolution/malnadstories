'use client';

import { useMemo, useRef } from 'react';
import { preloadImage, revokeLocalPreview } from '@/lib/builder/photo-url';

/**
 * LOCAL PREVIEW → PROCESSED IMAGE HANDOFF.
 *
 * When the worker finishes a photo, the poll learns its sanitized URLs — but the tile is
 * still showing the user's local blob. Committing the new URLs immediately would blank the
 * tile for as long as the network takes to deliver the thumbnail, and revoking the blob at
 * that moment would delete the only thing on screen.
 *
 * So the swap is GATED on the processed image actually decoding:
 *   1. `partition` holds back rows that are currently backed by a blob,
 *   2. `settle` preloads each one and commits only once it has loaded,
 *   3. the blob is revoked immediately after — never before.
 *
 * A row whose processed image FAILS to load keeps its blob (it is then the only working
 * preview) and is not retried, so a broken/expired signed URL can't spin the poll.
 *
 * Shared by the builder and the album-creation wizard — both poll `GET /api/photos` and
 * both need identical, correctness-critical blob timing.
 */

/** The subset of a `GET /api/photos` row this hook needs. */
export type HandoffRow = { id: string; status: string; thumbUrl: string };

export function usePreviewHandoff<T extends HandoffRow>() {
  // Rows already handed off (or permanently failed) — prevents re-preloading every tick.
  const inFlight = useRef<Set<string>>(new Set());

  // The returned object is REFERENTIALLY STABLE (all state lives in the ref above), so a
  // caller may list it in an effect's dependency array without restarting that effect —
  // exactly what the pollers need: their cadence must not change.
  return useMemo(() => {
    /**
     * Split incoming rows into "commit now" and "swap first".
     * `localUrlOf` reports the CURRENT local preview for an id (null when there is none).
     */
    const partition = (incoming: readonly T[], localUrlOf: (id: string) => string | null) => {
      const handoffs = incoming.filter(
        (r) =>
          r.status === 'ready' &&
          !!r.thumbUrl &&
          !inFlight.current.has(r.id) &&
          !!localUrlOf(r.id),
      );
      return { handoffs, deferred: new Set(handoffs.map((h) => h.id)) };
    };

    /**
     * Preload each handoff, then `commit(row, loaded)` and release the blob it replaced.
     * `isActive` lets the caller drop late resolutions after unmount / album change.
     */
    const settle = (
      handoffs: readonly T[],
      localUrlOf: (id: string) => string | null,
      commit: (row: T, loaded: boolean) => void,
      isActive: () => boolean,
    ) => {
      for (const row of handoffs) {
        inFlight.current.add(row.id);
        void preloadImage(row.thumbUrl).then((loaded) => {
          if (!isActive()) return;
          // Read the doomed URL BEFORE committing so revocation never runs in a reducer.
          const stale = loaded ? localUrlOf(row.id) : null;
          commit(row, loaded);
          revokeLocalPreview(stale);
          // On failure the id stays marked so we don't re-preload a broken URL every tick;
          // its blob is released when the host unmounts.
          if (loaded) inFlight.current.delete(row.id);
        });
      }
    };

    /** Drop bookkeeping for a photo that no longer exists (deleted). */
    const forget = (id: string) => {
      inFlight.current.delete(id);
    };

    return { partition, settle, forget };
  }, []);
}
