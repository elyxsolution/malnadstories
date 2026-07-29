'use client';

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { nudgeWorker } from '@/components/worker/nudge';
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  UploadManager,
  type ConfirmedUpload,
  type DiscardedUpload,
  type ExtractedMetadata,
  type QueuedUpload,
} from './manager';
import { aggregateMetrics, computeStats, summarizeSessions, type UploadTask } from './types';

/**
 * THE React binding for `UploadManager` — the single entry point every upload surface uses
 * (builder, creation wizard, and any future page). Consuming this hook is what makes them
 * share one implementation instead of three copies of presign → PUT → confirm.
 *
 * The manager lives in a ref, so it survives re-renders and owns its queue across the whole
 * session on that page. `useSyncExternalStore` subscribes React to it: the manager replaces
 * its task array only when something genuinely changed, so a render happens per real
 * transition rather than per network chunk.
 */

export type UseUploadManagerOptions = {
  /** Max simultaneous uploads. Default 3. */
  concurrency?: number;
  /** A file entered the queue — create the optimistic photo (Phase 3). */
  onQueued?: (info: QueuedUpload) => void;
  /**
   * A file became a real photo row. The host remaps its optimistic photo's id and takes
   * over the blob preview (Phase 1 handoff contract, unchanged).
   */
  onConfirmed?: (info: ConfirmedUpload) => void;
  /** A queued/uploading file was cancelled — drop its optimistic photo. */
  onDiscarded?: (info: DiscardedUpload) => void;
  /** The browser measured the file — attach client dimensions to the optimistic photo. */
  onMetadata?: (info: ExtractedMetadata) => void;
};

export type UploadManagerApi = ReturnType<typeof useUploadManager>;

export function useUploadManager(options: UseUploadManagerOptions = {}) {
  const { concurrency = DEFAULT_UPLOAD_CONCURRENCY } = options;

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

  const managerRef = useRef<UploadManager | null>(null);
  if (managerRef.current === null) {
    managerRef.current = new UploadManager({
      concurrency,
      onQueued: (info) => handlersRef.current.onQueued?.(info),
      onConfirmed: (info) => handlersRef.current.onConfirmed?.(info),
      onDiscarded: (info) => handlersRef.current.onDiscarded?.(info),
      onMetadata: (info) => handlersRef.current.onMetadata?.(info),
    });
  }
  const manager = managerRef.current;

  // Only pin the lane count when a caller EXPLICITLY asked for one. Left unset, the manager
  // steers it from measured throughput (Phase 5) — calling this unconditionally would switch
  // adaptation off on the very first render.
  const explicitConcurrency = options.concurrency;
  useEffect(() => {
    if (explicitConcurrency !== undefined) manager.setConcurrency(explicitConcurrency);
  }, [manager, explicitConcurrency]);

  // Abort in-flight work and release previews the manager still owns on unmount.
  // `activate()` re-arms on mount so React StrictMode's development mount→unmount→mount
  // cycle cannot leave the manager permanently torn down (nothing is in flight at that
  // point, so the extra teardown is a no-op).
  useEffect(() => {
    manager.activate();
    return () => manager.destroy();
  }, [manager]);

  const tasks = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);

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

  const enqueue = useCallback(
    (files: readonly File[] | FileList | null, albumId: string, limit?: number) => {
      if (!files) return 0;
      const accepted = manager.enqueue(files, albumId, limit);
      // Wake the (sleepable) worker without waiting for it — deduped app-wide (Phase 1).
      if (accepted > 0) nudgeWorker();
      return accepted;
    },
    [manager],
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
