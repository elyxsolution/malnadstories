'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '@/lib/builder/photo';
import { revokeLocalPreview } from '@/lib/builder/photo-url';
import { isTempPhotoId, useUploadManager, type UploadTask } from '@/lib/uploads';
import { mergePhotoRow, usePhotoPoll, type PhotoRow } from './_use-photo-poll';
import { useUrlRefresh } from './_use-url-refresh';
import { photoUiState, type PhotoUiState } from './_photo-state';

/**
 * THE PHOTO PIPELINE — one owner for everything that happens to a photo between the file picker
 * and a print-ready image.
 *
 * WHAT IT ABSORBS. This is the block of logic that had accumulated in the builder and been
 * partially copied into the creation wizard: the upload manager's four lifecycle callbacks, the
 * optimistic photo list, the progressive poll, the expiry-aware URL refresh, and blob cleanup.
 * The wizard's copy had already drifted — it never wired `onMetadata`, so photos uploaded there
 * gained no client dimensions. One implementation removes the drift by construction.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN. Layout. The builder places photos into blocks and therefore
 * has to remap block references when an optimistic id becomes real; the wizard has no layout at
 * all. That difference is expressed as two optional hooks — `onRemapId` and `onPhotoDropped` —
 * rather than by forking the pipeline. A host that lays out passes them; a host that doesn't,
 * doesn't.
 *
 * BEHAVIOUR IS UNCHANGED. Every call, order of operations and side effect is the same as before
 * the extraction; only the location moved. In particular the Phase 1–5 contracts are preserved
 * verbatim: blob ownership transfers at confirm (the task's reference is nulled so nothing
 * double-revokes), URLs stay sticky for ordinary polling and are force-adopted only on refresh,
 * and the poll's progressive cadence is untouched.
 */

export type PhotoPipelineOptions = {
  albumId: string | null;
  initialPhotos: Photo[];
  /**
   * The optimistic id became a real photo id. Layout-owning hosts remap their block references
   * (and undo history) here. Called BEFORE the photo list update is committed, matching the
   * original ordering exactly.
   */
  onRemapId?: (fromId: string, toId: string) => void;
  /** A photo left the album (cancelled upload). Layout-owning hosts strip it from their blocks. */
  onPhotoDropped?: (photoId: string) => void;
  /** Poll immediately on start — the wizard does; the builder waits one interval. */
  pollImmediately?: boolean;
  /** Extra condition to keep polling (the wizard polls once with an empty album). */
  pollWhen?: boolean;
};

export function usePhotoPipeline({
  albumId,
  initialPhotos,
  onRemapId,
  onPhotoDropped,
  pollImmediately = false,
  pollWhen = false,
}: PhotoPipelineOptions) {
  // Stamp the age of the server-rendered signed URLs at mount. They were minted moments before
  // this page rendered, so "now" is accurate to within the request — and it is what lets the
  // expiry-aware refresh know when they need replacing, without touching the server.
  const [photos, setPhotos] = useState<Photo[]>(() =>
    initialPhotos.map((p) => (p.url || p.thumbUrl ? { ...p, urlIssuedAt: Date.now() } : p)),
  );

  // Live mirror for async work that must NOT re-subscribe on every photo change (the poll, the
  // refresh sweep, blob cleanup, upload callbacks).
  const photosRef = useRef<Photo[]>(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const getPhotos = useCallback(() => photosRef.current, []);

  // Latest layout hooks without rebuilding the upload manager (which would drop its queue).
  const hooksRef = useRef({ onRemapId, onPhotoDropped });
  useEffect(() => {
    hooksRef.current = { onRemapId, onPhotoDropped };
  });

  const uploads = useUploadManager({
    /**
     * ALBUM SCOPE (Phase 3). The manager is shared by the whole session, so this pipeline states
     * which album it speaks for and the provider delivers it nothing else: every callback below
     * fires ONLY for uploads enqueued against this album, and `uploads.tasks` (with its stats,
     * sessions and temp-id lookup) contains only this album's tasks.
     *
     * The filter deliberately lives at that one boundary rather than being re-checked in each
     * callback. The events carry a task id, not an album, so a local check would have to
     * re-derive the album from the manager's task list — duplicating the exact derivation the
     * provider already performs, and giving the invariant two places to be wrong instead of one.
     */
    albumId,

    // A file was picked: the photo exists NOW, before any network call.
    onQueued: ({ tempPhotoId, filename, localUrl }) =>
      setPhotos((prev) => [
        ...prev,
        { id: tempPhotoId, url: '', thumbUrl: '', localUrl, filename, edit: null, status: 'pending', takenAt: null },
      ]),

    // The browser measured the file — real dimensions long before the worker produces them.
    onMetadata: ({ tempPhotoId, metadata }) =>
      setPhotos((prev) => prev.map((p) => (p.id === tempPhotoId ? { ...p, clientMeta: metadata } : p))),

    /**
     * The server issued a real id. The host remaps its layout first, then the photo list takes
     * the new id — the blob preview carries over untouched, so the pixels never change.
     *
     * ADOPTION. The return value tells the provider whether this surface actually took the blob.
     * It is read from `photosRef` (the live mirror) BEFORE the state update, because `setPhotos`
     * is asynchronous and its updater cannot report back — and because the honest answer is
     * exactly "do I hold a photo under this temp id right now?". A surface that mounted after
     * `onQueued` holds none, its `.map` below matches nothing, and it correctly claims nothing;
     * the provider then revokes rather than leaving the URL live and unreachable.
     *
     * The remap runs either way: a surface that cannot adopt the preview may still be holding
     * layout references to the temp id.
     */
    onConfirmed: ({ tempPhotoId, photoId, localUrl }) => {
      const adopted = photosRef.current.some((p) => p.id === tempPhotoId);
      hooksRef.current.onRemapId?.(tempPhotoId, photoId);
      setPhotos((prev) =>
        prev.map((p) => (p.id === tempPhotoId ? { ...p, id: photoId, localUrl, processingSince: Date.now() } : p)),
      );
      return adopted;
    },

    // Cancelled before it ever became a photo — drop it everywhere.
    onDiscarded: ({ tempPhotoId }) => {
      revokeLocalPreview(photosRef.current.find((p) => p.id === tempPhotoId)?.localUrl);
      hooksRef.current.onPhotoDropped?.(tempPhotoId);
      setPhotos((prev) => prev.filter((p) => p.id !== tempPhotoId));
    },
  });

  /**
   * Release previews THIS HOST OWNS when it unmounts — and only those.
   *
   * Blob ownership is the manager's until confirm, at which point it transfers to the photo
   * (the manager nulls its own reference so nothing double-revokes). A temp id is therefore an
   * exact marker for "the manager still owns this preview": ownership and the id change in the
   * same step.
   *
   * The `isTempPhotoId` guard matters because uploads now OUTLIVE the page that started them
   * (Phase 3). Without it, leaving the wizard mid-upload revoked previews for files that were
   * still uploading, so when they confirmed the manager handed the builder an already-dead
   * blob URL and the tiles arrived blank. Skipping them is safe: whatever the manager still
   * owns, the manager still releases — on cancel, or when the provider tears it down.
   */
  useEffect(
    () => () => {
      for (const p of photosRef.current) {
        if (isTempPhotoId(p.id)) continue;
        revokeLocalPreview(p.localUrl);
      }
    },
    [],
  );

  /**
   * ADOPT UPLOADS THIS SURFACE DID NOT START.
   *
   * `onQueued` only fires for files picked HERE, but uploads outlive the page that started them
   * (Phase 3): hand off from the creation wizard mid-upload and the builder inherits live tasks it
   * has no photo for. Left alone that costs the customer twice — the tray is missing photos that
   * are visibly still uploading, and when one confirms this surface truthfully reports that it
   * adopted nothing, so the provider revokes a preview that was the only image available until the
   * worker finishes.
   *
   * Seeding the same optimistic entry `onQueued` would have created fixes both, and it stays
   * inside this hook: no manager change, no protocol change, and the adoption handshake keeps
   * working exactly as designed — the entry now genuinely exists, so claiming the blob is honest.
   * Only live tasks are seeded; a cancelled or failed one is not a photo.
   */
  useEffect(() => {
    const inherited = uploads.tasks.filter(
      (t) =>
        t.photoId === null &&
        (t.state === 'queued' || t.state === 'local' || t.state === 'uploading') &&
        !photosRef.current.some((p) => p.id === t.tempPhotoId),
    );
    if (inherited.length === 0) return;
    setPhotos((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const add = inherited
        .filter((t) => !known.has(t.tempPhotoId))
        .map((t) => ({
          id: t.tempPhotoId,
          url: '',
          thumbUrl: '',
          localUrl: t.localUrl,
          filename: t.filename,
          edit: null,
          status: 'pending' as const,
          takenAt: null,
        }));
      return add.length > 0 ? [...prev, ...add] : prev;
    });
  }, [uploads.tasks]);

  /** The upload behind an optimistic photo, or undefined once it is a real photo. */
  const taskFor = useCallback(
    (photoId: string): UploadTask | undefined => uploads.taskByTempPhotoId.get(photoId),
    [uploads.taskByTempPhotoId],
  );

  /** The processing state of any photo — the single input every badge surface reads. */
  const photoStateFor = useCallback(
    (photoId: string): PhotoUiState | undefined => {
      const p = photosRef.current.find((x) => x.id === photoId);
      return p ? photoUiState(p, uploads.taskByTempPhotoId.get(photoId)) : undefined;
    },
    [uploads.taskByTempPhotoId],
  );

  // Only SERVER-side pending photos are worth polling for. An optimistic photo also carries
  // `status: 'pending'`, but the server has never heard of it.
  const pendingPhotos = photos.filter((p) => p.status === 'pending' && !isTempPhotoId(p.id)).length;
  const rejectedPhotos = photos.filter((p) => p.status === 'rejected').length;

  /**
   * PHOTOS THE ALBUM HAS THAT THIS SURFACE HASN'T SEEN.
   *
   * Uploads outlive the page that started them (Phase 3), so a file picked in the creation wizard
   * can confirm after the builder has taken over. The builder holds no optimistic entry for it —
   * it mounted later — so `onConfirmed` correctly adopts nothing, and the row would stay invisible
   * until the next full page load: the tray misses a photo, and any frame the layout points at it
   * renders empty.
   *
   * The manager's task table closes that gap. A task that has a `photoId` we don't hold is exactly
   * "the server has a photo this surface is missing", which is a precise reason to poll and one
   * that clears itself the moment the row is adopted (the poll already takes unknown ids).
   */
  const unknownConfirmed = useMemo(() => {
    const known = new Set(photos.map((p) => p.id));
    let n = 0;
    for (const t of uploads.tasks) if (t.photoId && !known.has(t.photoId)) n += 1;
    return n;
  }, [photos, uploads.tasks]);

  /** The longest-waiting photo, so status copy escalates on the worst case, not the best. */
  const oldestProcessingSince = useMemo(() => {
    let oldest: number | null = null;
    for (const p of photos) {
      if (p.status !== 'pending' || isTempPhotoId(p.id) || !p.processingSince) continue;
      if (oldest === null || p.processingSince < oldest) oldest = p.processingSince;
    }
    return oldest;
  }, [photos]);

  // Signed-URL refresh: only photos aging out (or reported broken) adopt a new URL.
  const { reportFailure } = useUrlRefresh({
    albumId,
    getPhotos,
    apply: useCallback((rows: PhotoRow[]) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      setPhotos((prev) =>
        prev.map((p) => {
          const row = byId.get(p.id);
          return row ? { ...p, ...mergePhotoRow(p, row, true) } : p;
        }),
      );
    }, []),
  });

  usePhotoPoll({
    albumId,
    enabled: pendingPhotos > 0 || unknownConfirmed > 0 || pollWhen,
    immediate: pollImmediately,
    resetKey: pendingPhotos + unknownConfirmed,
    getPhotos,
    apply: useCallback(
      (rows: PhotoRow[]) => {
        setPhotos((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const r of rows) {
            const ex = byId.get(r.id);
            // An unknown id is adopted (the wizard relies on this for a freshly created album);
            // a known one is patched in place. Both go through the same sticky-URL merge.
            byId.set(r.id, {
              id: r.id,
              filename: ex?.filename ?? 'photo',
              edit: ex?.edit ?? null,
              localUrl: ex?.localUrl ?? null,
              clientMeta: ex?.clientMeta ?? null,
              processingSince: ex?.processingSince ?? null,
              ...mergePhotoRow(ex, r),
            });
          }
          return Array.from(byId.values());
        });
        for (const r of rows) {
          if (r.status === 'ready') uploads.markReady(r.id);
          else if (r.status === 'rejected') uploads.markRejected(r.id);
        }
      },
      [uploads],
    ),
    applyHandoff: useCallback(
      (row: PhotoRow, loaded: boolean) => {
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === row.id
              ? {
                  ...p,
                  ...mergePhotoRow(p, row),
                  // A failed load keeps the blob — it is then the only working preview.
                  localUrl: loaded ? null : p.localUrl,
                }
              : p,
          ),
        );
        if (row.status === 'ready') uploads.markReady(row.id);
      },
      [uploads],
    ),
  });

  /** Remove a photo the host has already deleted server-side. */
  const dropPhoto = useCallback((photoId: string) => {
    revokeLocalPreview(photosRef.current.find((p) => p.id === photoId)?.localUrl);
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }, []);

  return {
    photos,
    setPhotos,
    getPhotos,
    uploads,
    taskFor,
    photoStateFor,
    pendingPhotos,
    rejectedPhotos,
    oldestProcessingSince,
    reportFailure,
    dropPhoto,
  };
}

export type PhotoPipelineApi = ReturnType<typeof usePhotoPipeline>;
