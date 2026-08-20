import { createLocalPreview, revokeLocalPreview } from '@/lib/builder/photo-url';
import { extractImageMetadata, type ClientImageMetadata } from './metadata';
import { record } from '@/lib/perf/metrics';
import { tempPhotoId } from './optimistic';
import {
  MAX_AUTO_ATTEMPTS,
  backoffDelay,
  classifyResponse,
  networkFailure,
  permanentFailure,
  timeoutFailure,
  type Classification,
} from './retry';
import {
  computeStats,
  type UploadEvent,
  type UploadStage,
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

/**
 * PUT TIMEOUTS (Phase 6). Before this, `xhr.timeout` was unset and no stall was detected, so a
 * socket that opened and then went silent held a concurrency lane FOREVER — the queue behind it
 * never drained and no retry could fire, because nothing ever failed.
 *
 * Two bounds, deliberately generous, because killing a slow-but-progressing upload is worse than
 * waiting:
 *
 *   • TOTAL (15 min) — the absolute ceiling for one PUT. 20 MB (the enforced maximum) over
 *     900 s is a floor of ~23 KB/s, which is below real 2G/EDGE throughput, so no upload that
 *     was ever going to finish is cut off by it.
 *   • STALL (3 min) — no `upload.onprogress` event at all. Progress fires per acknowledged
 *     chunk, so three minutes of literally zero bytes is a dead socket, not a slow one. This is
 *     what actually releases the lane in the common case; the total timeout is the backstop.
 *
 * Both feed the ordinary TRANSIENT retry path, so a stalled file is re-attempted rather than
 * lost, and neither touches the adaptive concurrency controller (which samples only successes).
 */
const PUT_TOTAL_TIMEOUT_MS = 15 * 60 * 1000;
const PUT_STALL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * NETWORK SUSPENSION (Phase 6). `navigator.onLine` is a hint, not a fact — a captive portal or a
 * dead upstream reports `true` while every request fails. So consecutive connection-level
 * failures are themselves a signal: after this many in a row the manager stops starting new work
 * instead of marching the whole queue into red tiles at network-error speed.
 */
const NET_FAIL_SUSPEND_THRESHOLD = 3;

/**
 * The ONE manager-level timer that exists while suspended. Not a poll loop and not per task:
 * it fires once, admits a SINGLE probe upload, and re-arms only if that probe also fails. That
 * bounds a fully-offline session to roughly one request every 30 s, regardless of queue depth,
 * and recovers even when the `online` event never arrives (it is unreliable on some platforms).
 */
const OFFLINE_BACKSTOP_MS = 30_000;

/** Presign's answer when the key is already owned by a photo row — confirm, don't re-upload. */
const ALREADY_SAVED = Symbol('already-saved');

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

  // ── Phase 6: automatic retry + offline suspension ────────────────────────────────
  /** Pending backoff timers, keyed by task id. EVERY scheduled retry is in here — see `clearRetryTimer`. */
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The single offline backstop timer (never one per task). */
  private backstopTimer: ReturnType<typeof setTimeout> | null = null;
  /** While true `pump()` starts nothing: queued work stays queued instead of failing. */
  private suspended = false;
  /** A backstop probe is in flight — admit exactly ONE task until it resolves. */
  private probing = false;
  /** Consecutive connection-level failures; `NET_FAIL_SUSPEND_THRESHOLD` of them suspends. */
  private netFailStreak = 0;
  private netListeners: (() => void) | null = null;

  constructor(options: UploadManagerOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY);
    this.onQueued = options.onQueued;
    this.onConfirmed = options.onConfirmed;
    this.onDiscarded = options.onDiscarded;
    this.onMetadata = options.onMetadata;
    this.installNetworkListeners();
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
        // Phase 6: no upload identity yet — it is minted by the FIRST successful presign and
        // then never changes for this task (decision C2). See `UploadTask.uploadKey`.
        uploadKey: null as string | null,
        stage: null as UploadStage | null,
        retryAt: null as number | null,
        autoAttempt: 0,
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
    // A manual retry supersedes any automatic one — there must never be two paths waiting to
    // requeue the same task.
    this.clearRetryTimer(taskId);
    this.patch(taskId, {
      state: 'queued',
      error: null,
      progress: 0,
      attempt: task.attempt + 1,
      // Give the automatic budget back: the customer explicitly asked for another go, and the
      // conditions that exhausted it (an outage, a dead tunnel) have usually changed by then.
      autoAttempt: 0,
      retryAt: null,
      // `uploadKey` and `stage` are DELIBERATELY preserved. A manual retry is the same logical
      // upload, so it resumes at the stage it stopped at with the identity it already owns —
      // exactly like an automatic one. Re-presigning here would fork the identity (C2 violation)
      // and, for a confirm-stage failure, create a duplicate photo row.
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
    // A cancelled task must never be resurrected by a timer that was already pending when the
    // user clicked — clearing it here is the primary guard (the timer body re-checks state too).
    this.clearRetryTimer(taskId);
    // Aborting rejects the PUT promise; `run` recognises the cancelled state and stops.
    this.xhrs.get(taskId)?.abort();
    this.xhrs.delete(taskId);
    this.active.delete(taskId);
    this.files.delete(taskId);
    revokeLocalPreview(task.localUrl);

    this.patch(taskId, { state: 'cancelled', localUrl: null, progress: 0, error: null, retryAt: null });
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
    // `destroy()` detaches the online/offline listeners, so re-arming has to re-attach them or a
    // StrictMode remount would leave the manager permanently blind to connectivity. Idempotent.
    this.installNetworkListeners();
  }

  /** Drop terminal tasks (ready / cancelled) so a long session doesn't grow unbounded. */
  prune(): void {
    const next = this.tasks.filter((t) => t.state !== 'ready' && t.state !== 'cancelled');
    if (next.length !== this.tasks.length) this.tasks = Object.freeze(next);
  }

  /** Abort everything and release every preview this manager still owns. */
  destroy(): void {
    this.destroyed = true;
    // NO TIMER SURVIVES DESTRUCTION. Signing out unmounts the provider, and a retry firing after
    // that would try to upload a signed-out user's file (and hold a closure over a dead manager).
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
    this.clearBackstop();
    this.netListeners?.();
    this.netListeners = null;
    this.suspended = false;
    this.probing = false;
    this.netFailStreak = 0;
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
    // SUSPENDED = the network is unusable. Starting work here is what used to turn a tunnel into
    // sixty red tiles: `pump()` refilled every lane as fast as each attempt failed. Returning
    // leaves the queue exactly as it is — same order, same states, no errors, no attempts burnt.
    if (this.suspended) return;
    // A backstop probe admits exactly one task, so a still-dead network costs one request, not a
    // full set of lanes.
    const limit = this.probing ? 1 : this.concurrency;
    while (this.active.size < limit && this.queue.length > 0) {
      const id = this.queue.shift() as string;
      const task = this.find(id);
      // A task cancelled while queued is simply skipped.
      if (!task || task.state !== 'queued') continue;
      this.active.add(id);
      void this.run(id);
    }
  }

  /**
   * presign → PUT → confirm for one task, RESUMABLE.
   *
   * THE NETWORK CONTRACT IS UNCHANGED — same three endpoints, same payloads (plus one optional
   * `key` field on presign), same order. What changed is the ENTRY POINT: a task that already
   * owns an upload key does not start over.
   *
   *   no key yet   → presign (mint) → PUT → confirm
   *   stage 'put'  → presign (RE-SIGN THE SAME KEY) → PUT → confirm
   *   stage 'confirm' → confirm ONLY, with the same key
   *
   * The last line is the one that matters most. `photos.upload_key` is globally unique (0053) and
   * `/api/photos/confirm` is idempotent per key, so re-confirming returns the SAME photo id and
   * creates no second row, no second hardening job and no second cap slot. Re-entering presign
   * there would mint a fresh key and defeat all three of those guarantees at once.
   */
  private async run(taskId: string): Promise<void> {
    const task = this.find(taskId);
    const file = this.files.get(taskId);
    if (!task || !file) {
      this.active.delete(taskId);
      this.probing = false;
      this.pump();
      return;
    }

    const startedAt = Date.now();
    if (task.timings.queuedAt !== null) record('upload.queueWait', startedAt - task.timings.queuedAt);

    // THE RESUME POINT, derived from state the task already carries rather than from a flag a
    // caller could forget to set. Owning a key is exactly "the bytes have somewhere to go".
    const resumeAt: UploadStage =
      task.uploadKey === null ? 'presign' : task.stage === 'confirm' ? 'confirm' : 'put';

    this.patch(taskId, {
      state: 'uploading',
      stage: resumeAt,
      retryAt: null,
      // A confirm-stage resume already has its bytes on R2; showing 0 % would be a lie.
      progress: resumeAt === 'confirm' ? 100 : 0,
      timings: { ...task.timings, startedAt },
    });
    this.emitFor(taskId, (t) => ({ type: 'started', task: t }));

    try {
      let key = task.uploadKey;

      if (resumeAt !== 'confirm') {
        // ── presign ─────────────────────────────────────────────────────────────────
        // `key` is sent ONLY on a retry that already owns one (C2). The server re-validates it
        // from scratch — ownership, album, prefix, shape, extension, and that no photo row has
        // claimed it — so this is a request to re-sign a key we own, never a way to name one.
        const issued = await this.presign(task, key);
        if (this.isCancelled(taskId)) return;

        if (issued === ALREADY_SAVED) {
          // The server refuses to re-sign a key a photo row already owns. That means this upload
          // DID succeed and only its confirm response was lost. Falling through to confirm
          // resolves it to the same photo id; starting a new upload would duplicate it.
          this.progressed(taskId, 'confirm');
        } else {
          key = issued.key;
          this.pinUploadKey(taskId, key);
          this.progressed(taskId, 'put');
          if (this.isCancelled(taskId)) return;

          // ── PUT ───────────────────────────────────────────────────────────────────
          // Same key on every attempt, so a retry OVERWRITES its own object rather than
          // stranding one. R2 PUT is last-writer-wins and the bytes are identical.
          const putStarted = Date.now();
          await this.put(taskId, issued.url, file, task.contentType);
          if (this.isCancelled(taskId)) return;
          this.patch(taskId, { progress: 100, timings: { ...this.timingsOf(taskId), uploadedAt: Date.now() } });
          // Steer the lane count from what this upload actually achieved.
          this.observeThroughput(task.size, Date.now() - putStarted);
          this.progressed(taskId, 'confirm');
          if (this.isCancelled(taskId)) return;
        }
      }

      // ── confirm ───────────────────────────────────────────────────────────────────
      if (key === null) throw new StageFailure(permanentFailure('Could not save photo'));
      const confirm = await this.post(
        '/api/photos/confirm',
        { albumId: task.albumId, key, originalFilename: task.filename },
        'Could not save photo',
      );
      if (this.isCancelled(taskId)) return;
      const photoId = typeof confirm.data?.id === 'string' ? confirm.data.id : null;
      if (photoId === null) throw new StageFailure(permanentFailure('Could not save photo'));

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
        stage: null,
        retryAt: null,
        autoAttempt: 0,
        timings: { ...this.timingsOf(taskId), confirmedAt: Date.now() },
      });
      this.noteSuccess();

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
      // An unrecognised throw is a bug in our own code, not a network condition: classifying it
      // as permanent stops it becoming an infinite retry loop.
      const cls =
        err instanceof StageFailure
          ? err.classification
          : permanentFailure(err instanceof Error ? err.message : 'Upload failed');
      this.handleFailure(taskId, cls);
    } finally {
      this.xhrs.delete(taskId);
      this.active.delete(taskId);
      // Whatever this attempt was, the probe window (if this was one) is over.
      this.probing = false;
      this.pump();
    }
  }

  /**
   * Ask for a presigned PUT URL — minting a key, or re-signing the one this task already owns.
   *
   * Returns `ALREADY_SAVED` for the one coded response that is not really a failure: a 409
   * `key_already_used` means a photo row already owns this key, i.e. the upload finished and we
   * simply never saw the confirm response. The caller resolves that by confirming, which is
   * idempotent, rather than by starting a second upload.
   */
  private async presign(
    task: UploadTask,
    key: string | null,
  ): Promise<{ url: string; key: string } | typeof ALREADY_SAVED> {
    let res: { status: number; data: Record<string, unknown> | null };
    try {
      res = await this.post(
        '/api/photos/presign',
        {
          albumId: task.albumId,
          filename: task.filename,
          contentType: task.contentType,
          size: task.size,
          ...(key === null ? {} : { key }),
        },
        'Could not start upload',
      );
    } catch (err) {
      if (key !== null && err instanceof StageFailure && err.body?.code === 'key_already_used') {
        return ALREADY_SAVED;
      }
      throw err;
    }

    const url = typeof res.data?.url === 'string' ? res.data.url : null;
    const issuedKey = typeof res.data?.key === 'string' ? res.data.key : null;
    if (url === null || issuedKey === null) throw new StageFailure(permanentFailure('Could not start upload'));
    // An identity must never change silently. If the server ever answered a re-sign with a
    // different key we would upload under one identity and confirm another — the duplicate-row
    // bug wearing a different hat — so it is a hard stop, not a warning.
    if (key !== null && issuedKey !== key) {
      throw new StageFailure(permanentFailure('Could not resume this upload'));
    }
    return { url, key: issuedKey };
  }

  // ── Phase 6: retry policy ─────────────────────────────────────────────────────────

  /**
   * POST JSON, reading the STATUS BEFORE THE BODY.
   *
   * The old code called `res.json()` first and only then checked `res.ok`. A 502 from an edge
   * proxy answers with an HTML error page, so the parse threw and `SyntaxError: Unexpected
   * token '<'` became the customer's error message — simultaneously leaking a parser diagnostic
   * and hiding a retryable outage behind something that looks deterministic. Status first means
   * a 502 is classified as transient no matter what shape its body is.
   */
  private async post(
    url: string,
    body: unknown,
    fallback: string,
  ): Promise<{ status: number; data: Record<string, unknown> | null }> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // `fetch` rejects only for connection-level problems — never for an HTTP error status.
      throw new StageFailure(networkFailure());
    }

    const data = await readJsonBody(res);
    if (!res.ok) {
      const serverMessage = typeof data?.error === 'string' ? data.error : null;
      throw new StageFailure(
        classifyResponse(res.status, res.headers.get('retry-after'), serverMessage, fallback),
        data,
      );
    }
    return { status: res.status, data };
  }

  /** Record the first (and only) upload key this task will ever own. */
  private pinUploadKey(taskId: string, key: string): void {
    const task = this.find(taskId);
    if (!task || task.uploadKey !== null) return; // first mint only — see UploadTask.uploadKey
    this.patch(taskId, { uploadKey: key });
  }

  /**
   * A stage completed. Advancing the stage is what makes the next retry resume in the right
   * place; resetting `autoAttempt` is what stops an early blip from spending a later stage's
   * budget (a file that got through presign and PUT should not be one failure from giving up).
   */
  private progressed(taskId: string, stage: UploadStage): void {
    this.patch(taskId, { stage, autoAttempt: 0 });
    this.noteSuccess();
  }

  /** Any successful round trip proves the network works — clear the offline evidence. */
  private noteSuccess(): void {
    this.netFailStreak = 0;
    if (this.suspended) this.resume();
  }

  /** Decide what one failed attempt means: retry with backoff, wait for the network, or stop. */
  private handleFailure(taskId: string, cls: Classification): void {
    const task = this.find(taskId);
    if (!task) return;

    // Connection-level failures double as the offline detector, because `navigator.onLine` lies
    // (a captive portal reports "online" while every request dies).
    const connectionLevel = cls.kind === 'network' || cls.kind === 'timeout';
    if (connectionLevel) {
      this.netFailStreak += 1;
      // `onLine === false` is reliable in the negative direction, so trust it immediately;
      // otherwise wait for a run of failures before concluding the path is unusable.
      if (!isOnline() || this.netFailStreak >= NET_FAIL_SUSPEND_THRESHOLD) this.suspend();
    } else {
      this.netFailStreak = 0;
    }

    // A photo that already has a server row is the worker's business, not the uploader's.
    const retryable = cls.transient && this.files.has(taskId) && task.photoId === null;
    // Being offline must not cost the customer their retry budget — a batch caught in a tunnel
    // would otherwise burn all four attempts in seconds and surface as failures on reconnect.
    const free = cls.kind === 'network' && (this.suspended || !isOnline());

    if (retryable && (free || task.autoAttempt < MAX_AUTO_ATTEMPTS)) {
      this.scheduleRetry(taskId, cls, free);
      return;
    }

    if (cls.transient) record('upload.retry.exhausted', 1);
    // Keep the preview AND the file: the tile still shows which photo failed, and Retry
    // can re-run it without asking the user to pick the file again.
    this.patch(taskId, { state: 'failed', error: cls.message, retryAt: null });
    this.emitFor(taskId, (t) => ({ type: 'failed', task: t, error: cls.message }));
  }

  /**
   * Put a task back in line after a transient failure.
   *
   * The task stays in state `queued` — no new UploadState — so capacity reservation
   * (`stats.inFlight`), the badges and the batch progress bar all keep working untouched. While
   * it waits it is NOT in the FIFO, so it holds no concurrency lane and cannot block unrelated
   * files; when the timer fires it re-enters at the TAIL, so a repeatedly-failing file can never
   * monopolise the queue ahead of photos picked afterwards.
   */
  private scheduleRetry(taskId: string, cls: Classification, free: boolean): void {
    const task = this.find(taskId);
    if (!task) return;

    record('upload.retry.attempted', 1);
    record(
      cls.kind === 'rate-limit'
        ? 'upload.retry.429'
        : cls.kind === 'server'
          ? 'upload.retry.5xx'
          : 'upload.retry.network',
      1,
    );

    const requeued: Partial<UploadTask> = {
      state: 'queued',
      progress: 0,
      error: null,
      autoAttempt: free ? task.autoAttempt : task.autoAttempt + 1,
      // `uploadKey` and `stage` are untouched — they ARE the resume point.
      timings: { ...task.timings, queuedAt: Date.now() },
    };

    // SUSPENDED: no per-task timer at all. The task simply waits in the FIFO until the queue
    // itself restarts (the `online` event, or the single backstop). This is what keeps an
    // offline session down to ONE timer for the whole manager, however deep the queue is.
    if (this.suspended) {
      this.patch(taskId, { ...requeued, retryAt: null });
      if (!this.queue.includes(taskId)) this.queue.push(taskId);
      this.emitFor(taskId, (t) => ({ type: 'queued', task: t }));
      return;
    }

    // A server-supplied Retry-After wins: ignoring it means fighting our own rate limiter.
    const delay = cls.retryAfterMs ?? backoffDelay(task.autoAttempt);
    this.patch(taskId, { ...requeued, retryAt: Date.now() + delay });
    this.emitFor(taskId, (t) => ({ type: 'queued', task: t }));

    const timer = setTimeout(() => {
      this.retryTimers.delete(taskId);
      if (this.releaseRetry(taskId)) this.pump();
    }, delay);
    this.retryTimers.set(taskId, timer);
  }

  /**
   * Move a waiting task back into the FIFO. Returns whether it actually did.
   *
   * STALE TIMER PROTECTION. Between scheduling and firing the task may have been cancelled,
   * manually retried, destroyed, or had its File released. Re-reading the LIVE task and
   * refusing on any mismatch is what guarantees a stale timer can never resurrect it — the
   * timer is authoritative about nothing; the task is.
   */
  private releaseRetry(taskId: string): boolean {
    if (this.destroyed) return false;
    const task = this.find(taskId);
    if (!task || task.state !== 'queued' || task.retryAt === null) return false;
    if (!this.files.has(taskId)) return false;
    if (this.active.has(taskId) || this.queue.includes(taskId)) return false;
    this.patch(taskId, { retryAt: null });
    this.queue.push(taskId); // TAIL — FIFO fairness against files picked later
    return true;
  }

  private clearRetryTimer(taskId: string): void {
    const timer = this.retryTimers.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.retryTimers.delete(taskId);
  }

  // ── Phase 6: offline suspension ───────────────────────────────────────────────────

  /** Attach the connectivity listeners. Idempotent, and a no-op outside a browser. */
  private installNetworkListeners(): void {
    if (this.netListeners !== null) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onOffline = () => this.suspend();
    const onOnline = () => this.resume();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    this.netListeners = () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }

  /**
   * Stop starting work. Queued files stay queued and silent — no red tiles, no burnt attempts —
   * and healthy in-flight PUTs are deliberately left alone: an upload that is still moving is
   * evidence the network works, whatever the `offline` event just claimed.
   */
  private suspend(): void {
    if (this.suspended || this.destroyed) return;
    this.suspended = true;
    this.probing = false;
    record('upload.offline.pause', 1);
    // Per-task backoff timers are meaningless now — collapse them into the FIFO so that exactly
    // one manager-level timer remains while offline.
    this.retryTimers.forEach((timer, id) => {
      clearTimeout(timer);
      const task = this.find(id);
      if (task && task.state === 'queued' && !this.queue.includes(id) && !this.active.has(id)) {
        this.patch(id, { retryAt: null });
        this.queue.push(id);
      }
    });
    this.retryTimers.clear();
    this.armBackstop();
  }

  /** Connectivity is back (or proven back): drop suspension and restart the existing queue. */
  private resume(): void {
    if (this.destroyed) return;
    this.clearBackstop();
    this.netFailStreak = 0;
    this.probing = false;
    if (this.suspended) {
      this.suspended = false;
      record('upload.offline.resume', 1);
    }
    // Anything serving out a backoff is eligible NOW: connectivity is the thing it was waiting
    // for, so making it sit out an arbitrary timer would only delay recovery.
    const waiting = Array.from(this.retryTimers.keys());
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
    for (const id of waiting) this.releaseRetry(id);
    this.pump();
  }

  /**
   * ONE timer, manager-wide, armed only while suspended. It exists because the `online` event is
   * not reliable on every platform; it admits a SINGLE probe upload rather than a full set of
   * lanes, so a still-dead network costs one request per interval regardless of queue depth.
   * This is deliberately not a poll: nothing is scheduled while the queue is empty.
   */
  private armBackstop(): void {
    if (this.backstopTimer !== null || this.destroyed) return;
    this.backstopTimer = setTimeout(() => {
      this.backstopTimer = null;
      if (this.destroyed || !this.suspended) return;
      this.suspended = false;
      this.probing = true;
      this.pump();
      if (this.active.size === 0) {
        // Nothing to probe with. Stop holding a timer entirely — the next enqueue discovers the
        // network state on its own, and an idle manager should own no timers at all.
        this.probing = false;
      }
    }, OFFLINE_BACKSTOP_MS);
    this.backstopTimer.unref?.();
  }

  private clearBackstop(): void {
    if (this.backstopTimer === null) return;
    clearTimeout(this.backstopTimer);
    this.backstopTimer = null;
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

  /**
   * The R2 PUT, with byte-accurate progress, an abort handle for cancel, and — new in Phase 6 —
   * two bounds so a silent socket cannot hold a concurrency lane forever. See
   * `PUT_TOTAL_TIMEOUT_MS` / `PUT_STALL_TIMEOUT_MS` for why those values are safe.
   */
  private put(taskId: string, url: string, file: File, contentType: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.xhrs.set(taskId, xhr);

      // The stall watchdog is ONE rescheduled timeout per request, reset by each progress event —
      // not a poll. It is what actually frees a wedged lane; `xhr.timeout` is the outer backstop.
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      let stalled = false;
      const clearStall = () => {
        if (stallTimer !== null) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };
      const armStall = () => {
        clearStall();
        stallTimer = setTimeout(() => {
          stalled = true;
          xhr.abort(); // surfaces via onabort, which reads `stalled` to classify it correctly
        }, PUT_STALL_TIMEOUT_MS);
      };

      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.timeout = PUT_TOTAL_TIMEOUT_MS;
      xhr.upload.onprogress = (e) => {
        armStall();
        if (e.lengthComputable) this.setProgress(taskId, Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        clearStall();
        if (xhr.status >= 200 && xhr.status < 300) return resolve();
        // `status === 0` here means the response never arrived — a connection problem, not a
        // verdict. Everything else is a real HTTP status, classified on its number.
        if (xhr.status === 0) return reject(new StageFailure(networkFailure('Network error during upload')));
        reject(
          new StageFailure(
            classifyResponse(
              xhr.status,
              xhr.getResponseHeader('retry-after'),
              null,
              `Upload failed (${xhr.status})`,
            ),
          ),
        );
      };
      xhr.onerror = () => {
        clearStall();
        reject(new StageFailure(networkFailure('Network error during upload')));
      };
      xhr.ontimeout = () => {
        clearStall();
        reject(new StageFailure(timeoutFailure()));
      };
      xhr.onabort = () => {
        clearStall();
        // A stall abort is OURS and is transient. A user cancel also lands here, but `run`'s
        // `isCancelled` check short-circuits before this classification is ever consulted.
        reject(stalled ? new StageFailure(timeoutFailure()) : new StageFailure(permanentFailure('Upload cancelled')));
      };
      armStall();
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

/**
 * A failed attempt carrying its VERDICT rather than just a string. Everything thrown inside
 * `run` is one of these, so the catch never has to guess what a message meant.
 */
class StageFailure extends Error {
  constructor(
    readonly classification: Classification,
    /** The parsed error body, when there was one. Used for coded server responses. */
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(classification.message);
    this.name = 'StageFailure';
  }
}

/**
 * Parse a JSON body defensively. Called only AFTER the status has been read, and returns `null`
 * rather than throwing for an HTML/empty/truncated body — so a proxy's error page can never
 * become the customer's error message.
 */
async function readJsonBody(res: Response): Promise<Record<string, unknown> | null> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return null;
  try {
    const parsed: unknown = await res.json();
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * `navigator.onLine === true` proves nothing (a captive portal reports it while every request
 * fails), but `false` is reliable — so this is only ever trusted in the negative direction.
 */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
