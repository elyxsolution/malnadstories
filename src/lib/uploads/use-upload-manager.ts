'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { nudgeWorker } from '@/components/worker/nudge';
import {
  type ConfirmedUpload,
  type DiscardedUpload,
  type ExtractedMetadata,
  type QueuedUpload,
} from './manager';
import { useUploadContext } from './upload-provider';
import { aggregateMetrics, computeStats, summarizeSessions, type UploadTask } from './types';

/**
 * THE React binding for `UploadManager` — the single entry point every upload surface uses
 * (builder, creation wizard, and any future page). Consuming this hook is what makes them
 * share one implementation instead of three copies of presign → PUT → confirm.
 *
 * OWNERSHIP (Phase 3). The manager is no longer created here. It belongs to `UploadProvider`,
 * mounted once in `(app)/layout.tsx` — a layout Phase 0 proved is not remounted by the
 * `/albums/new → /albums/[id]/build` navigation. This hook is now purely a VIEW onto that
 * session-scoped instance, which is what lets an upload keep running after the page that
 * started it has unmounted. Correspondingly there is no `destroy()` here any more: a consumer
 * unmounting is a page change, not a reason to abort the customer's uploads.
 *
 * `useSyncExternalStore` subscribes React to the manager: it replaces its task array only when
 * something genuinely changed, so a render happens per real transition rather than per network
 * chunk.
 *
 * ALBUM SCOPE. Because the manager is shared, this hook is ALBUM-SCOPED: `albumId` is required,
 * and both halves of the view are filtered by it — the task snapshot (and everything derived
 * from it) here, and the four lifecycle callbacks at the provider. An upload belonging to
 * another album is therefore invisible to this surface and can never mutate its state.
 */

export type UseUploadManagerOptions = {
  /**
   * THE ALBUM THIS SURFACE SPEAKS FOR — required, and the isolation boundary for everything
   * below. Tasks, lookups, stats, sessions, metrics and all four lifecycle callbacks are scoped
   * to it, so an upload belonging to another album can neither be observed here nor mutate this
   * surface's state. `null` (the wizard before its album exists) scopes to nothing.
   */
  albumId: string | null;
  /** Max simultaneous uploads. Default 3. */
  concurrency?: number;
  /** A file entered the queue — create the optimistic photo (Phase 3). */
  onQueued?: (info: QueuedUpload) => void;
  /**
   * A file became a real photo row. The host remaps its optimistic photo's id and takes
   * over the blob preview (Phase 1 handoff contract, unchanged).
   *
   * MUST return `true` if — and only if — it actually took ownership of `info.localUrl` (it held
   * a photo under `tempPhotoId` and stored the blob on it). Returning nothing/false means "I did
   * not take it", and the provider revokes the URL rather than leaving it live and unreachable.
   * `info.localUrl` is null when another surface has already adopted it.
   */
  onConfirmed?: (info: ConfirmedUpload) => boolean | void;
  /** A queued/uploading file was cancelled — drop its optimistic photo. */
  onDiscarded?: (info: DiscardedUpload) => void;
  /** The browser measured the file — attach client dimensions to the optimistic photo. */
  onMetadata?: (info: ExtractedMetadata) => void;
};

export type UploadManagerApi = ReturnType<typeof useUploadManager>;

/** Stable empty scope, so a null album never churns consumer memos. */
const NO_TASKS: readonly UploadTask[] = Object.freeze([]);

export function useUploadManager(options: UseUploadManagerOptions) {
  const { albumId } = options;

  // Keep the latest callbacks without ever rebuilding the manager (which would drop the
  // queue mid-batch). The manager reads them through this ref, so hosts can pass inline
  // closures without stabilising them.
  const handlersRef = useRef({
    onQueued: options.onQueued,
    onConfirmed: options.onConfirmed,
    onDiscarded: options.onDiscarded,
    onMetadata: options.onMetadata,
  });
  useEffect(() => {
    handlersRef.current = {
      onQueued: options.onQueued,
      onConfirmed: options.onConfirmed,
      onDiscarded: options.onDiscarded,
      onMetadata: options.onMetadata,
    };
  });

  // The session's manager, owned by <UploadProvider>. Stable across re-renders AND across
  // navigation between upload surfaces — that stability is the whole point of Phase 3.
  const { manager, registerHandlers } = useUploadContext();

  /**
   * Subscribe this surface's lifecycle callbacks to the shared manager.
   *
   * The manager takes its callbacks at construction and is now constructed by the provider,
   * before any surface exists — so the provider owns permanent fan-out closures and surfaces
   * register here. The indirection through `handlersRef` is unchanged, so consumers may still
   * pass inline closures without stabilising them, and registering never disturbs a queue that
   * is already running.
   */
  useEffect(
    () =>
      registerHandlers(albumId, {
        onQueued: (info) => handlersRef.current.onQueued?.(info),
        // The adoption verdict must travel back to the provider — see UploadHandlers.onConfirmed.
        onConfirmed: (info) => handlersRef.current.onConfirmed?.(info),
        onDiscarded: (info) => handlersRef.current.onDiscarded?.(info),
        onMetadata: (info) => handlersRef.current.onMetadata?.(info),
      }),
    [registerHandlers, albumId],
  );

  // Only pin the lane count when a caller EXPLICITLY asked for one. Left unset, the manager
  // steers it from measured throughput (Phase 5) — calling this unconditionally would switch
  // adaptation off on the very first render.
  const explicitConcurrency = options.concurrency;
  useEffect(() => {
    if (explicitConcurrency !== undefined) manager.setConcurrency(explicitConcurrency);
  }, [manager, explicitConcurrency]);

  // NO teardown here (Phase 3). A surface unmounting is a page change, not a reason to abort
  // the customer's uploads — destroying the manager here is exactly what killed an upload when
  // the wizard handed over to the builder. Lifetime belongs to <UploadProvider>, which also
  // owns `activate()`.

  const allTasks = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

  /**
   * THE SCOPED SNAPSHOT. Everything below derives from this, so filtering once here scopes the
   * task list, the temp-id lookup, the stats, the sessions and the metrics together — there is
   * no path by which a foreign album's task can reach a consumer, and no per-surface rendering
   * filter that a new call site could forget to apply.
   */
  const tasks = useMemo(
    () => (albumId === null ? NO_TASKS : allTasks.filter((t) => t.albumId === albumId)),
    [allTasks, albumId],
  );

  const stats = useMemo(() => computeStats(tasks), [tasks]);
  const metrics = useMemo(() => aggregateMetrics(tasks), [tasks]);
  /** Per-batch progress — derived, never stored (see `summarizeSessions`). */
  const sessions = useMemo(() => summarizeSessions(tasks), [tasks]);
  const activeSessions = useMemo(() => sessions.filter((s) => !s.done), [sessions]);

  /**
   * Task lookup by the optimistic photo id it backs. Phase 3: a photo renders its upload
   * state (queued / uploading / failed) by asking here — one map, no duplicated progress.
   */
  const taskByTempPhotoId = useMemo(() => {
    const map = new Map<string, UploadTask>();
    for (const t of tasks) map.set(t.tempPhotoId, t);
    return map;
  }, [tasks]);

  /**
   * Enqueue into THIS SURFACE'S album.
   *
   * The `albumId` parameter is retained for call-site compatibility, but the hook's own scope
   * WINS: a surface can only ever create tasks for the album it is scoped to, so it is
   * structurally impossible to enqueue into an album whose events this surface would then never
   * see. The argument is only consulted when the scope is null (no album yet), which is the one
   * case where it is the sole source of truth.
   */
  const enqueue = useCallback(
    (files: readonly File[] | FileList | null, argAlbumId: string, limit?: number) => {
      if (!files) return 0;
      const accepted = manager.enqueue(files, albumId ?? argAlbumId, limit);
      // Wake the (sleepable) worker without waiting for it — deduped app-wide (Phase 1).
      if (accepted > 0) nudgeWorker();
      return accepted;
    },
    [manager, albumId],
  );

  const retry = useCallback((taskId: string) => manager.retry(taskId), [manager]);
  const cancel = useCallback((taskId: string) => manager.cancel(taskId), [manager]);
  const markReady = useCallback((photoId: string) => manager.markReady(photoId), [manager]);
  const markRejected = useCallback((photoId: string) => manager.markRejected(photoId), [manager]);
  /** Drop settled tasks. Not automatic — a finished task is tiny and keeps its timings. */
  const prune = useCallback(() => manager.prune(), [manager]);

  return {
    manager,
    tasks,
    taskByTempPhotoId,
    sessions,
    activeSessions,
    stats,
    metrics,
    enqueue,
    retry,
    cancel,
    markReady,
    markRejected,
    prune,
  };
}
