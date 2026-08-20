/**
 * UPLOAD DOMAIN TYPES — the vocabulary the Upload Manager, its queue, and every upload
 * surface share.
 *
 * THE CENTRAL RULE: `UploadState` is a CLIENT-SIDE UI state. It is NOT `photos.status`.
 * The server knows three values (`pending` / `ready` / `rejected`) and knows nothing about
 * a file sitting in a browser queue. Overloading the backend status to describe "waiting
 * behind two other uploads" would put a fiction in the data model; keeping them separate
 * lets the UI describe the full journey (picked → queued → uploading → …) while the photo
 * row keeps meaning exactly what it always meant.
 *
 * The two vocabularies meet at exactly one point: when an upload confirms, the task learns
 * its `photoId`, and from then on the PHOTO owns the tile. The task lives on only to record
 * how it finished (and its timings).
 */

/** Client-side lifecycle of one file, from picker to processed. */
export const UPLOAD_STATES = [
  'local', // created, preview made, not yet admitted to the queue
  'queued', // waiting for a free concurrency slot
  'uploading', // presign + PUT in flight
  'processing', // confirmed on the server; the worker is sanitizing it
  'ready', // worker finished — the photo is usable
  'failed', // presign/PUT/confirm failed, or the worker rejected it
  'cancelled', // the user aborted it before it became a photo
] as const;

export type UploadState = (typeof UPLOAD_STATES)[number];

/**
 * The three network stages inside `uploading`. Phase 6 records which one a task reached so a
 * retry can RESUME rather than restart — the difference between reusing an upload identity and
 * silently minting a second one. Deliberately NOT an `UploadState`: adding a state would ripple
 * through `computeStats`, capacity accounting and every badge, for a distinction the customer
 * never needs to see.
 */
export const UPLOAD_STAGES = ['presign', 'put', 'confirm'] as const;
export type UploadStage = (typeof UPLOAD_STAGES)[number];

/** States from which no further transition happens on its own. */
export const TERMINAL_UPLOAD_STATES: readonly UploadState[] = ['ready', 'failed', 'cancelled'];

/**
 * Wall-clock marks for one task. Each is set exactly once, when that boundary is crossed;
 * durations are derived (see `uploadMetrics`) rather than accumulated, so a missing mark
 * yields `null` instead of a misleading zero.
 */
export type UploadTimings = {
  /** The moment the user picked the file. */
  selectedAt: number;
  /** Admitted to the queue (also reset on retry). */
  queuedAt: number | null;
  /** A concurrency slot opened and work began. */
  startedAt: number | null;
  /** The R2 PUT completed. */
  uploadedAt: number | null;
  /** `/api/photos/confirm` returned a photo id. */
  confirmedAt: number | null;
  /** The poll observed the worker finish. */
  readyAt: number | null;
};

/**
 * One file's journey. Immutable from the consumer's side — the manager replaces the object
 * on every change, so React can diff by identity.
 *
 * The `File` itself is deliberately NOT here: the manager holds it in a side map and
 * releases it the moment it is no longer needed (see `UploadManager`), so a finished batch
 * of 100 photos doesn't pin 500 MB of file data in React state.
 */
export type UploadTask = {
  /** Client-side task id. A RENDER KEY — never sent to the server, never a photo id. */
  readonly id: string;
  /**
   * THE UPLOAD IDENTITY (Phase 6, decision C2) — the R2 object key this logical file owns,
   * for its entire life. `null` until the first presign succeeds, then FIXED: a PUT retry
   * re-signs this same key, and a confirm retry sends this same key.
   *
   * Why it lives on the task rather than in a local variable inside `run()`: `photos.upload_key`
   * is globally unique (0053) and is what makes `/api/photos/confirm` idempotent. Minting a
   * fresh key per attempt — which is what happened before this field existed — turned every
   * confirm retry into a SECOND photo row, a second hardening job, a second consumed cap slot,
   * and left the previous R2 object orphaned. Pinning the key here is what makes
   * "one picked File ⇒ one photo row" hold across retries.
   */
  readonly uploadKey: string | null;
  /**
   * The network stage this task is in (or the one a scheduled retry will RESUME at). `null`
   * before any attempt. This is the other half of same-key retry: a confirm-stage failure
   * resumes at `confirm` and must never re-enter presign.
   */
  readonly stage: UploadStage | null;
  /**
   * Absolute wall-clock time an automatic retry becomes eligible, or `null` when not waiting.
   * A waiting task stays in state `queued` (so capacity accounting and every badge keep
   * working unchanged) but is deliberately NOT in the FIFO, so it holds no concurrency lane.
   */
  readonly retryAt: number | null;
  /**
   * AUTOMATIC retries used so far, bounded by `MAX_AUTO_ATTEMPTS`. Reset to 0 on any
   * successful stage transition, so an early blip cannot exhaust a later stage's budget.
   * Deliberately separate from `attempt`, which stays the user-facing manual counter.
   */
  readonly autoAttempt: number;
  /** The batch this file was picked in (see `summarizeSessions`). */
  readonly sessionId: string;
  /**
   * The optimistic photo id (`tmp_<id>`) this task backs. Phase 3: a photo exists in the
   * builder under this id from the moment the file is picked, and is remapped to the real
   * photo id on confirm.
   */
  readonly tempPhotoId: string;
  readonly albumId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly state: UploadState;
  /** 0–100, byte-accurate for the R2 PUT. */
  readonly progress: number;
  readonly error: string | null;
  /** Local `blob:` preview, or null (HEIC, or already handed off to the photo). */
  readonly localUrl: string | null;
  /** Set once `confirm` succeeds. Non-null ⇒ a real photo row owns this file now. */
  readonly photoId: string | null;
  /** 1 on first attempt, incremented by each retry. */
  readonly attempt: number;
  readonly timings: UploadTimings;
};

/**
 * Lifecycle events. A single stream replaces the scattered booleans of the old flow —
 * subscribers react to transitions instead of diffing flags.
 */
export type UploadEvent =
  | { type: 'queued'; task: UploadTask }
  | { type: 'started'; task: UploadTask }
  | { type: 'progress'; task: UploadTask }
  | { type: 'confirmed'; task: UploadTask; photoId: string }
  | { type: 'processing'; task: UploadTask }
  | { type: 'ready'; task: UploadTask }
  | { type: 'failed'; task: UploadTask; error: string }
  | { type: 'cancelled'; task: UploadTask };

export type UploadEventType = UploadEvent['type'];

/** Counts across the whole task list. */
export type UploadStats = {
  queued: number;
  uploading: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  /** Work not yet finished: queued + uploading + processing. */
  remaining: number;
  /** Not yet a server photo: queued + uploading. This is what capacity accounting uses. */
  inFlight: number;
  /**
   * Failures the user can actually act on — an upload that never became a photo. A photo the
   * WORKER rejected also counts as `failed`, but it already reports itself on its own tile
   * and cannot be re-uploaded, so it is excluded here.
   */
  retryable: number;
};

/** Derived durations for one task. `null` where the boundary was never crossed. */
export type UploadMetrics = {
  /** Sat in the queue waiting for a slot. */
  queueWaitMs: number | null;
  /** presign + bytes on the wire. */
  uploadMs: number | null;
  /** `/api/photos/confirm` round-trip. */
  confirmMs: number | null;
  /** Server-side worker time, as observed by the client poll. */
  processingMs: number | null;
  /** Picker → usable photo. The number the user actually feels. */
  totalMs: number | null;
};

const ms = (from: number | null, to: number | null): number | null =>
  from === null || to === null ? null : Math.max(0, to - from);

/** Derive one task's durations from its marks. Pure. */
export function uploadMetrics(task: UploadTask): UploadMetrics {
  const t = task.timings;
  return {
    queueWaitMs: ms(t.queuedAt, t.startedAt),
    uploadMs: ms(t.startedAt, t.uploadedAt),
    confirmMs: ms(t.uploadedAt, t.confirmedAt),
    processingMs: ms(t.confirmedAt, t.readyAt),
    totalMs: ms(t.selectedAt, t.readyAt),
  };
}

/** Mean of each duration across tasks that recorded it. `null` when none did. */
export function aggregateMetrics(tasks: readonly UploadTask[]): UploadMetrics & { samples: number } {
  const keys = ['queueWaitMs', 'uploadMs', 'confirmMs', 'processingMs', 'totalMs'] as const;
  const sums: Record<(typeof keys)[number], { total: number; n: number }> = {
    queueWaitMs: { total: 0, n: 0 },
    uploadMs: { total: 0, n: 0 },
    confirmMs: { total: 0, n: 0 },
    processingMs: { total: 0, n: 0 },
    totalMs: { total: 0, n: 0 },
  };
  for (const task of tasks) {
    const m = uploadMetrics(task);
    for (const k of keys) {
      const v = m[k];
      if (v !== null) {
        sums[k].total += v;
        sums[k].n += 1;
      }
    }
  }
  const avg = (k: (typeof keys)[number]) => (sums[k].n === 0 ? null : Math.round(sums[k].total / sums[k].n));
  return {
    queueWaitMs: avg('queueWaitMs'),
    uploadMs: avg('uploadMs'),
    confirmMs: avg('confirmMs'),
    processingMs: avg('processingMs'),
    totalMs: avg('totalMs'),
    samples: sums.totalMs.n,
  };
}

/**
 * UPLOAD SESSION — one batch of files, picked together.
 *
 * Deliberately DERIVED, never stored: a session is just the tasks that share a
 * `sessionId`, summarized on demand. Keeping a parallel session collection would be a
 * second source of truth that could drift from the tasks it describes. The seam is here
 * for later analytics/notifications; today it powers per-batch progress.
 */
export type UploadSessionSummary = {
  id: string;
  albumId: string;
  /** Earliest `selectedAt` in the batch. */
  startedAt: number;
  total: number;
  queued: number;
  uploading: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  bytesTotal: number;
  /**
   * 0–1 across the whole journey. Upload is weighted at half and processing the other
   * half, so the bar keeps moving after the bytes land instead of parking at 100%.
   */
  progress: number;
  /** Nothing left queued, uploading or processing. */
  done: boolean;
};

/** Group tasks into per-batch summaries, newest batch last. Pure. */
export function summarizeSessions(tasks: readonly UploadTask[]): UploadSessionSummary[] {
  const bySession = new Map<string, UploadTask[]>();
  for (const t of tasks) {
    const list = bySession.get(t.sessionId);
    if (list) list.push(t);
    else bySession.set(t.sessionId, [t]);
  }

  const summaries: UploadSessionSummary[] = [];
  bySession.forEach((group, id) => {
    const s = computeStats(group);
    // Half the bar is bytes, half is the worker. A queued file contributes nothing, an
    // uploading one contributes its own progress, and anything past confirm has the whole
    // upload half plus (for `ready`) the processing half.
    let earned = 0;
    for (const t of group) {
      if (t.state === 'uploading') earned += (t.progress / 100) * 0.5;
      else if (t.state === 'processing') earned += 0.5;
      else if (t.state === 'ready' || t.state === 'failed' || t.state === 'cancelled') earned += 1;
    }
    summaries.push({
      id,
      albumId: group[0].albumId,
      startedAt: group.reduce((min, t) => Math.min(min, t.timings.selectedAt), Number.POSITIVE_INFINITY),
      total: group.length,
      queued: s.queued,
      uploading: s.uploading,
      processing: s.processing,
      completed: s.completed,
      failed: s.failed,
      cancelled: s.cancelled,
      bytesTotal: group.reduce((sum, t) => sum + t.size, 0),
      progress: group.length === 0 ? 1 : Math.min(1, earned / group.length),
      done: s.remaining === 0,
    });
  });

  return summaries.sort((a, b) => a.startedAt - b.startedAt);
}

/** Count tasks by state. Pure. */
export function computeStats(tasks: readonly UploadTask[]): UploadStats {
  let queued = 0;
  let uploading = 0;
  let processing = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let retryable = 0;
  for (const t of tasks) {
    if (t.state === 'queued' || t.state === 'local') queued += 1;
    else if (t.state === 'uploading') uploading += 1;
    else if (t.state === 'processing') processing += 1;
    else if (t.state === 'ready') completed += 1;
    else if (t.state === 'failed') {
      failed += 1;
      if (t.photoId === null) retryable += 1;
    } else if (t.state === 'cancelled') cancelled += 1;
  }
  return {
    queued,
    uploading,
    processing,
    completed,
    failed,
    cancelled,
    total: tasks.length,
    remaining: queued + uploading + processing,
    inFlight: queued + uploading,
    retryable,
  };
}
