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
    // A file was picked: the photo exists NOW, before any network call.
    onQueued: ({ tempPhotoId, filename, localUrl }) =>
      setPhotos((prev) => [
        ...prev,
        { id: tempPhotoId, url: '', thumbUrl: '', localUrl, filename, edit: null, status: 'pending', takenAt: null },
      ]),

    // The browser measured the file — real dimensions long before the worker produces them.
    onMetadata: ({ tempPhotoId, metadata }) =>
      setPhotos((prev) => prev.map((p) => (p.id === tempPhotoId ? { ...p, clientMeta: metadata } : p))),

    // The server issued a real id. The host remaps its layout first, then the photo list takes
    // the new id — the blob preview carries over untouched, so the pixels never change.
    onConfirmed: ({ tempPhotoId, photoId, localUrl }) => {
      hooksRef.current.onRemapId?.(tempPhotoId, photoId);
      setPhotos((prev) =>
        prev.map((p) => (p.id === tempPhotoId ? { ...p, id: photoId, localUrl, processingSince: Date.now() } : p)),
      );
    },

    // Cancelled before it ever became a photo — drop it everywhere.
    onDiscarded: ({ tempPhotoId }) => {
      revokeLocalPreview(photosRef.current.find((p) => p.id === tempPhotoId)?.localUrl);
      hooksRef.current.onPhotoDropped?.(tempPhotoId);
      setPhotos((prev) => prev.filter((p) => p.id !== tempPhotoId));
    },
  });

  // Release any preview still held when the host unmounts.
  useEffect(
    () => () => {
      for (const p of photosRef.current) revokeLocalPreview(p.localUrl);
    },
    [],
  );

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
    enabled: pendingPhotos > 0 || pollWhen,
    immediate: pollImmediately,
    resetKey: pendingPhotos,
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
