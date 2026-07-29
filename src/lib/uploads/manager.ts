import { createLocalPreview, revokeLocalPreview } from '@/lib/builder/photo-url';
import { extractImageMetadata, type ClientImageMetadata } from './metadata';
import { record } from '@/lib/perf/metrics';
import { tempPhotoId } from './optimistic';
import {
  computeStats,
  type UploadEvent,
  type UploadState,
  type UploadStats,
  type UploadTask,
  type UploadTimings,
} from './types';

/**
 * THE UPLOAD MANAGER — one owner for the queue, the scheduler, and the lifecycle of every
 * file the user picks.
 *
 * WHY A CLASS, NOT A HOOK. The scheduler needs mutable state that must NOT be tied to a
 * render (the queue, the active set, live XHR handles). Framework-free means it is
 * testable without React, reusable from any surface, and — critically — a progress event
 * arriving mid-render can never corrupt it. `useUploadManager` is the thin React binding;
 * this file has no React import at all.
 *
 * THE SCHEDULER. Uploads used to be `batch.forEach(uploadOne)` — 100 files meant 100
 * simultaneous presigns and 100 simultaneous PUTs, splitting bandwidth 100 ways so nothing
 * finished early, and firing ~300 state updates a second. Here a bounded number run at
 * once (default 3) and the rest wait in a FIFO array. `pump()` is the only thing that ever
 * starts work, and every completion path calls it, so the queue drains automatically and
 * can never stall with idle slots.
 *
 * MEMORY. A `File` is held only while it might still be needed: released on confirm (the
 * bytes are on R2 — re-uploading is meaningless) and on cancel. Only in-flight and FAILED
 * tasks pin file data, which is exactly the set that could still be retried.
 *
 * BLOB OWNERSHIP (Phase 1 contract, preserved). A task owns its `localUrl` until confirm,
 * at which point ownership TRANSFERS to the photo row (`onConfirmed` hands it over and the
 * task's own reference is cleared, so nothing double-revokes). A task that fails keeps its
 * preview so the failed tile still shows which photo it was.
 *
 * BACKEND. Untouched. The presign → PUT → confirm sequence, its payloads, and its headers
 * are byte-for-byte what they were; only the scheduling around them changed.
 */

/** Mirrors the server's accepted types (`PresignUploadSchema` / `ALLOWED_CONTENT_TYPES`). */
const ALLOWED = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];
const MAX_BYTES = 20 * 1024 * 1024;

/** Default concurrency. Low enough that each upload gets real bandwidth, high enough to hide latency. */
export const DEFAULT_UPLOAD_CONCURRENCY = 3;

/**
 * ADAPTIVE CONCURRENCY BOUNDS (Phase 5).
 *
 * A fixed lane count is wrong at both ends: on fibre it leaves throughput unused, and on a weak
 * mobile connection three parallel PUTs just split the same pipe three ways while making each
 * individual photo take three times as long to appear.
 *
 * The controller therefore steers on MEASURED throughput (bytes ÷ upload duration), not on
 * `navigator.connection` — which is advisory, absent in Safari, and describes the device's link
 * rather than the path to R2.
 *
 * Three rules keep it stable, because an oscillating uploader is worse than a fixed one:
 *   • it moves by ONE lane at a time, never jumping,
 *   • it needs a full window of fresh samples before moving again, and
 *   • the thresholds are far apart (hysteresis), so throughput hovering near a boundary does
 *     not flip the decision back and forth.
 */
const MIN_CONCURRENCY = 2;
const MAX_CONCURRENCY = 6;
/** Completed uploads to observe before considering an adjustment. */
const ADAPT_WINDOW = 3;
/** Above this per-upload throughput, add a lane. Below the lower bound, remove one. */
const FAST_KBPS = 1500;
const SLOW_KBPS = 300;

const EMPTY: readonly UploadTask[] = Object.freeze([]);

/** Browsers sometimes report an empty type for HEIC; fall back to the extension. */
export function resolveContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'heic') return 'image/heic';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return '';
}

/** A file admitted to the queue — the moment an OPTIMISTIC photo should appear. */
export type QueuedUpload = {
  taskId: string;
  sessionId: string;
  /** The optimistic photo id (`tmp_…`) the host should create its photo under. */
  tempPhotoId: string;
  albumId: string;
  filename: string;
  /** Local blob preview, or null when the type can't be previewed (HEIC). */
  localUrl: string | null;
};

export type ConfirmedUpload = {
  taskId: string;
  sessionId: string;
  /** The optimistic id this photo has been living under — remap FROM this. */
  tempPhotoId: string;
  /** The server's real photo id — remap TO this. */
  photoId: string;
  filename: string;
  /** The blob preview, ownership transferred to the caller. May be null (HEIC). */
  localUrl: string | null;
};

/** A file that will never become a photo — the host should drop its optimistic photo. */
export type DiscardedUpload = {
  taskId: string;
  tempPhotoId: string;
  reason: 'cancelled';
};

/** Dimensions read from the user's own bytes, moments after the file was picked. */
export type ExtractedMetadata = {
  taskId: string;
  /** The photo id to attach it to — still the temp id at this point. */
  tempPhotoId: string;
  metadata: ClientImageMetadata;
};

export type UploadManagerOptions = {
  concurrency?: number;
  /**
   * Fired the instant a file is admitted to the queue, BEFORE any network call. Phase 3:
   * the host creates an optimistic photo here, so the user can place it immediately.
   */
  onQueued?: (info: QueuedUpload) => void;
  /**
   * Fired when a file becomes a real photo row. The host REMAPS its optimistic photo from
   * `tempPhotoId` to `photoId` and takes over the blob preview. This — together with
   * `onQueued` — is the entire seam between upload state and photo state; the manager
   * never touches the host's photo list itself.
   */
  onConfirmed?: (info: ConfirmedUpload) => void;
  /** Fired when a queued/uploading file is cancelled, so the host can drop its photo. */
  onDiscarded?: (info: DiscardedUpload) => void;
  /**
   * Fired a few milliseconds after `onQueued`, once the browser has measured the file. Gives
   * the optimistic photo real dimensions long before the worker does — which is what lets
   * auto-layout run immediately.
   */
  onMetadata?: (info: ExtractedMetadata) => void;
};

export class UploadManager {
  private tasks: readonly UploadTask[] = EMPTY;
  /** FIFO of task ids awaiting a slot. Head is next. */
  private queue: string[] = [];
  private active = new Set<string>();
  private files = new Map<string, File>();
  private xhrs = new Map<string, XMLHttpRequest>();
  private listeners = new Set<(event: UploadEvent) => void>();
  private concurrency: number;
  private readonly onQueued?: (info: QueuedUpload) => void;
  private readonly onConfirmed?: (info: ConfirmedUpload) => void;
  private readonly onDiscarded?: (info: DiscardedUpload) => void;
  private readonly onMetadata?: (info: ExtractedMetadata) => void;
  private destroyed = false;
  /** Steering is on until a caller sets concurrency explicitly. */
  private adaptive = true;
  private samples: number[] = [];

  constructor(options: UploadManagerOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY);
    this.onQueued = options.onQueued;
    this.onConfirmed = options.onConfirmed;
    this.onDiscarded = options.onDiscarded;
    this.onMetadata = options.onMetadata;
  }

  // ── external store surface (stable identities for useSyncExternalStore) ──────────

  subscribe = (listener: (event: UploadEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current task list. Identity changes ONLY when something actually changed. */
  getSnapshot = (): readonly UploadTask[] => this.tasks;

  getStats = (): UploadStats => computeStats(this.tasks);

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, Math.floor(n));
    this.adaptive = false; // an explicit setting wins; stop steering
    this.pump();
  }

  /** Current lane count — exposed for diagnostics and the status UI. */
  getConcurrency(): number {
    return this.concurrency;
  }

  /**
   * Feed one completed upload's throughput to the controller and adjust at most one lane.
   * Called only on success, where `uploadMs` reflects real bytes over real time.
   */
  private observeThroughput(bytes: number, ms: number): void {
    if (!this.adaptive || ms <= 0 || bytes <= 0) return;
    const kbps = bytes / 1024 / (ms / 1000);
    record('upload.throughput', kbps);
    this.samples.push(kbps);
    if (this.samples.length < ADAPT_WINDOW) return;

    // Median, not mean: one stalled upload shouldn't drag the whole decision down.
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.samples = []; // require a fresh window before moving again

    const before = this.concurrency;
    if (median > FAST_KBPS && this.concurrency < MAX_CONCURRENCY) this.concurrency += 1;
    else if (median < SLOW_KBPS && this.concurrency > MIN_CONCURRENCY) this.concurrency -= 1;
    if (this.concurrency !== before) this.pump();
  }

  // ── intake ───────────────────────────────────────────────────────────────────────

  /**
   * Validate, preview and enqueue files IN THE ORDER GIVEN (deterministic FIFO).
   * `limit` caps how many are admitted — the caller passes the album's remaining slots, so
   * client-side capacity behaviour is unchanged. Returns the number admitted.
   *
   * Rejected files (bad type / oversize) are added as already-`failed` tasks rather than
   * dropped silently, so the user sees which file was refused and why.
   */
  enqueue(files: readonly File[] | FileList, albumId: string, limit?: number): number {
    if (this.destroyed) return 0;
    const list = Array.from(files);
    const batch = typeof limit === 'number' ? list.slice(0, Math.max(0, limit)) : list;
    if (batch.length === 0) return 0;

    const now = Date.now();
    const created: UploadTask[] = [];
    // One session per pick/drop — the unit a progress bar or a "12 photos added" notice
    // would talk about. Derived summaries live in `summarizeSessions`.
    const sessionId = newTaskId();

    for (const file of batch) {
      const id = newTaskId();
      const contentType = resolveContentType(file);
      const base = {
        id,
        sessionId,
        tempPhotoId: tempPhotoId(id),
        albumId,
        filename: file.name,
        contentType,
        size: file.size,
        progress: 0,
        localUrl: null as string | null,
        photoId: null,
        attempt: 1,
        timings: { selectedAt: now, queuedAt: null, startedAt: null, uploadedAt: null, confirmedAt: null, readyAt: null } as UploadTimings,
      };

      if (!ALLOWED.includes(contentType)) {
        created.push({ ...base, state: 'failed', error: 'Unsupported file type' });
        continue;
      }
      if (file.size > MAX_BYTES) {
        created.push({ ...base, state: 'failed', error: 'File exceeds 20 MB' });
        continue;
      }

      // Instant preview from the user's own bytes (Phase 1). Null for HEIC.
      const localUrl = createLocalPreview(file, contentType);
      this.files.set(id, file);
      created.push({
        ...base,
        localUrl,
        state: 'queued',
        error: null,
        timings: { ...base.timings, queuedAt: now },
      });
      this.queue.push(id);
    }

    this.tasks = Object.freeze([...this.tasks, ...created]);
    for (const task of created) {
      if (task.state === 'failed') {
        this.emit({ type: 'failed', task, error: task.error ?? 'Rejected' });
        continue;
      }
      this.emit({ type: 'queued', task });
      // The optimistic photo appears HERE — before presign, before any byte moves.
      this.onQueued?.({
        taskId: task.id,
        sessionId: task.sessionId,
        tempPhotoId: task.tempPhotoId,
        albumId: task.albumId,
        filename: task.filename,
        localUrl: task.localUrl,
      });
      // Measure AFTER announcing the photo, so the tile is on screen first. Fire-and-forget:
      // a slow or failed decode delays nothing and breaks nothing.
      void this.measure(task.id);
    }
    this.pump();
    return created.filter((t) => t.state === 'queued').length;
  }

  // ── user actions ─────────────────────────────────────────────────────────────────

  /**
   * Re-queue a failed upload. The preview and the file are already held, so retrying costs
   * nothing extra; the task goes to the TAIL of the queue, so FIFO fairness is preserved
   * and a retry can't jump ahead of files the user picked afterwards. Its position in the
   * visible list is unchanged.
   */
  retry(taskId: string): void {
    const task = this.find(taskId);
    if (!task || task.state !== 'failed' || !this.files.has(taskId)) return;
    this.patch(taskId, {
      state: 'queued',
      error: null,
      progress: 0,
      attempt: task.attempt + 1,
      timings: { ...task.timings, queuedAt: Date.now(), startedAt: null, uploadedAt: null, confirmedAt: null },
    });
    this.queue.push(taskId);
    const updated = this.find(taskId);
    if (updated) this.emit({ type: 'queued', task: updated });
    this.pump();
  }

  /**
   * Abort an upload that has not yet become a photo.
   *
   * Deliberately a NO-OP once `photoId` is set: at that point a server row exists and
   * removal is the photo-delete path (`DELETE /api/photos/:id`), which is unchanged. This
   * manager never issues a DELETE — it cannot, by construction, call it for a photo that
   * doesn't exist.
   */
  cancel(taskId: string): void {
    const task = this.find(taskId);
    if (!task || task.photoId !== null) return;
    if (task.state === 'cancelled' || task.state === 'ready') return;

    this.queue = this.queue.filter((id) => id !== taskId);
    // Aborting rejects the PUT promise; `run` recognises the cancelled state and stops.
    this.xhrs.get(taskId)?.abort();
    this.xhrs.delete(taskId);
    this.active.delete(taskId);
    this.files.delete(taskId);
    revokeLocalPreview(task.localUrl);

    this.patch(taskId, { state: 'cancelled', localUrl: null, progress: 0, error: null });
    const updated = this.find(taskId);
    if (updated) this.emit({ type: 'cancelled', task: updated });
    // The optimistic photo will never become real — the host must drop it (and anywhere
    // it was placed), or the layout would keep a slot pointing at nothing.
    this.onDiscarded?.({ taskId, tempPhotoId: task.tempPhotoId, reason: 'cancelled' });
    this.pump();
  }

  // ── signals from the photo poll ──────────────────────────────────────────────────

  /** The worker finished this photo. Completes the task's lifecycle + processing timing. */
  markReady(photoId: string): void {
    const task = this.tasks.find((t) => t.photoId === photoId);
    if (!task || task.state !== 'processing') return;
    this.patch(task.id, { state: 'ready', timings: { ...task.timings, readyAt: Date.now() } });
    const updated = this.find(task.id);
    if (updated) this.emit({ type: 'ready', task: updated });
  }

  /** The worker permanently rejected this photo (spoofed type, bomb guard, undecodable). */
  markRejected(photoId: string, reason = 'Could not be processed'): void {
    const task = this.tasks.find((t) => t.photoId === photoId);
    if (!task || task.state !== 'processing') return;
    this.patch(task.id, { state: 'failed', error: reason });
    const updated = this.find(task.id);
    if (updated) this.emit({ type: 'failed', task: updated, error: reason });
  }

  // ── teardown ─────────────────────────────────────────────────────────────────────

  /**
   * Re-arm after a `destroy()`.
   *
   * React StrictMode mounts, unmounts and re-mounts every effect in development, so the
   * binding hook's cleanup fires once on the initial mount. Without this the manager would
   * latch `destroyed` and silently refuse every upload in dev. Calling `activate()` on
   * (re-)mount makes the lifecycle idempotent; at that point nothing is ever in flight, so
   * the spurious teardown has nothing to tear down.
   */
  activate(): void {
    this.destroyed = false;
  }

  /** Drop terminal tasks (ready / cancelled) so a long session doesn't grow unbounded. */
  prune(): void {
    const next = this.tasks.filter((t) => t.state !== 'ready' && t.state !== 'cancelled');
    if (next.length !== this.tasks.length) this.tasks = Object.freeze(next);
  }

  /** Abort everything and release every preview this manager still owns. */
  destroy(): void {
    this.destroyed = true;
    this.xhrs.forEach((xhr) => xhr.abort());
    this.xhrs.clear();
    this.active.clear();
    this.queue = [];
    this.files.clear();
    // Handed-off previews already have localUrl === null, so a photo's blob is never
    // revoked here — only what this manager still owns.
    for (const task of this.tasks) revokeLocalPreview(task.localUrl);
    this.tasks = EMPTY;
    this.listeners.clear();
  }

  // ── scheduler ────────────────────────────────────────────────────────────────────

  /**
   * THE ONLY place work starts. Fill free slots from the head of the queue. Called after
   * every intake, every completion, every retry and every cancel — so slots are never left
   * idle while the queue is non-empty, and nothing needs to poll.
   */
  private pump(): void {
    if (this.destroyed) return;
    while (this.active.size < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift() as string;
      const task = this.find(id);
      // A task cancelled while queued is simply skipped.
      if (!task || task.state !== 'queued') continue;
      this.active.add(id);
      void this.run(id);
    }
  }

  /** presign → PUT → confirm for one task. Unchanged network contract. */
  private async run(taskId: string): Promise<void> {
    const task = this.find(taskId);
    const file = this.files.get(taskId);
    if (!task || !file) {
      this.active.delete(taskId);
      this.pump();
      return;
    }

    const startedAt = Date.now();
    if (task.timings.queuedAt !== null) record('upload.queueWait', startedAt - task.timings.queuedAt);
    this.patch(taskId, { state: 'uploading', progress: 0, timings: { ...task.timings, startedAt } });
    this.emitFor(taskId, (t) => ({ type: 'started', task: t }));

    try {
      const presignRes = await fetch('/api/photos/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId: task.albumId, filename: task.filename, contentType: task.contentType, size: task.size }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || 'Could not start upload');
      if (this.isCancelled(taskId)) return;

      const putStarted = Date.now();
      await this.put(taskId, presign.url, file, task.contentType);
      if (this.isCancelled(taskId)) return;
      this.patch(taskId, { progress: 100, timings: { ...this.timingsOf(taskId), uploadedAt: Date.now() } });
      // Steer the lane count from what this upload actually achieved.
      this.observeThroughput(task.size, Date.now() - putStarted);

      const confirmRes = await fetch('/api/photos/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId: task.albumId, key: presign.key, originalFilename: task.filename }),
      });
      const confirm = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirm.error || 'Could not save photo');
      if (this.isCancelled(taskId)) return;

      const photoId = confirm.id as string;
      const localUrl = this.find(taskId)?.localUrl ?? null;

      // The bytes are safely on R2 and a row exists — this file can never need re-uploading,
      // so release it now rather than pinning it for the rest of the session.
      this.files.delete(taskId);

      // State moves to `processing`, and the preview's ownership moves with the photo:
      // clearing `localUrl` here is what guarantees only ONE owner can revoke it.
      this.patch(taskId, {
        state: 'processing',
        photoId,
        localUrl: null,
        error: null,
        timings: { ...this.timingsOf(taskId), confirmedAt: Date.now() },
      });

      const confirmed = this.find(taskId);
      if (confirmed) {
        this.emit({ type: 'confirmed', task: confirmed, photoId });
        this.emit({ type: 'processing', task: confirmed });
      }
      this.onConfirmed?.({
        taskId,
        sessionId: task.sessionId,
        tempPhotoId: task.tempPhotoId,
        photoId,
        filename: task.filename,
        localUrl,
      });
    } catch (err) {
      // A cancel aborts the XHR, which surfaces here — that is not a failure.
      if (this.isCancelled(taskId) || this.destroyed) return;
      const message = err instanceof Error ? err.message : 'Upload failed';
      // Keep the preview AND the file: the tile still shows which photo failed, and Retry
      // can re-run it without asking the user to pick the file again.
      this.patch(taskId, { state: 'failed', error: message });
      this.emitFor(taskId, (t) => ({ type: 'failed', task: t, error: message }));
    } finally {
      this.xhrs.delete(taskId);
      this.active.delete(taskId);
      this.pump();
    }
  }

  /**
   * Read dimensions + EXIF orientation from the picked file and hand them to the host.
   *
   * Entirely best-effort and entirely off the critical path: it never blocks the queue, never
   * gates the upload, and a null result just means this photo waits for the worker as before.
   */
  private async measure(taskId: string): Promise<void> {
    if (!this.onMetadata) return;
    const task = this.find(taskId);
    const file = this.files.get(taskId);
    if (!task || !file) return;
    try {
      const metadata = await extractImageMetadata(file, task.contentType);
      if (!metadata || this.destroyed) return;
      // The task may have been cancelled while we were decoding.
      const current = this.find(taskId);
      if (!current || current.state === 'cancelled') return;
      this.onMetadata({ taskId, tempPhotoId: current.tempPhotoId, metadata });
    } catch {
      /* measurement is an enhancement — never a failure path */
    }
  }

  /** The R2 PUT, with byte-accurate progress and an abort handle for cancel. */
  private put(taskId: string, url: string, file: File, contentType: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhrs.set(taskId, xhr);
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) this.setProgress(taskId, Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort = () => reject(new Error('Upload cancelled'));
      xhr.send(file);
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────────

  private find(taskId: string): UploadTask | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  private timingsOf(taskId: string): UploadTimings {
    return (
      this.find(taskId)?.timings ?? {
        selectedAt: Date.now(),
        queuedAt: null,
        startedAt: null,
        uploadedAt: null,
        confirmedAt: null,
        readyAt: null,
      }
    );
  }

  private isCancelled(taskId: string): boolean {
    const state: UploadState | undefined = this.find(taskId)?.state;
    return state === undefined || state === 'cancelled';
  }

  /** Replace one task, producing a new frozen list so consumers can diff by identity. */
  private patch(taskId: string, changes: Partial<UploadTask>): void {
    let touched = false;
    const next = this.tasks.map((t) => {
      if (t.id !== taskId) return t;
      touched = true;
      return { ...t, ...changes } as UploadTask;
    });
    if (touched) this.tasks = Object.freeze(next);
  }

  /**
   * Progress is the highest-frequency signal in the system. Ignoring same-percent repeats
   * keeps the snapshot identity stable, so React re-renders at most 100 times per upload
   * instead of once per network chunk.
   */
  private setProgress(taskId: string, progress: number): void {
    const task = this.find(taskId);
    if (!task || task.progress === progress || task.state !== 'uploading') return;
    this.patch(taskId, { progress });
    this.emitFor(taskId, (t) => ({ type: 'progress', task: t }));
  }

  private emitFor(taskId: string, make: (task: UploadTask) => UploadEvent): void {
    const task = this.find(taskId);
    if (task) this.emit(make(task));
  }

  private emit(event: UploadEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // A misbehaving subscriber must never break the scheduler.
      }
    });
  }
}

function newTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `task-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
