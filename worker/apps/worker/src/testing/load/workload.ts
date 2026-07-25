import type { Job, JobType } from '../../job.js';
import type { Processor } from '../../processors/registry.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import { CancellationError } from '../../recovery/cancellation.js';
import type { FaultController } from '../chaos/faults.js';
import type { FakeBroker } from '../fakes/fake-broker.js';

/**
 * WORKLOAD GENERATION + SYNTHETIC PROCESSORS.
 *
 * WHY SYNTHETIC. What Phase I-5 validates is the ARCHITECTURE around processors — dispatch,
 * concurrency lanes, queue semantics, recovery, backpressure, shutdown — not sharp's encoder or
 * Chromium's renderer, both of which have their own suites. A synthetic processor with a
 * configurable duration and failure pattern exercises every one of those paths deterministically,
 * in milliseconds, at volumes (10,000 jobs) that real codecs could never reach in a test run.
 *
 * The synthetics are FAITHFUL where it matters: they observe cancellation at the same granularity a
 * real pipeline does, they distinguish retryable from terminal failure the same way, and they
 * declare the same job types — so the lane, retry and drain behaviour under test is the real thing.
 *
 * The generator and harness accept ANY `Processor`, so the same framework drives real processors
 * (image + PDF, against the fakes) whenever an end-to-end run is wanted. That is the reusability
 * requirement: a future processor is load-tested by registering it, not by extending this file.
 */

export const IMAGE = 'image-hardening';
export const PDF = 'album-pdf';
export const CLEANUP = 'r2-cleanup';

/** The shape of a generated workload. */
export interface WorkloadSpec {
  /** Jobs to enqueue per type. */
  readonly counts: Readonly<Record<JobType, number>>;
  /** Interleave types instead of enqueuing type-by-type (models real arrival order). */
  readonly interleave?: boolean;
  /** Delay applied to every job (models pg-boss `startAfter`). */
  readonly delayMs?: number;
}

/** A canonical mixed workload: many images, a few PDFs, some cleanup. */
export function mixedWorkload(scale = 1): WorkloadSpec {
  return {
    counts: { [IMAGE]: 100 * scale, [PDF]: 5 * scale, [CLEANUP]: 20 * scale },
    interleave: true,
  };
}

/** Enqueue `spec` onto the broker. Returns the ids, in enqueue order. */
export function generateWorkload(broker: FakeBroker, spec: WorkloadSpec): string[] {
  const ids: string[] = [];
  const entries = Object.entries(spec.counts).filter(([, count]) => count > 0);

  if (spec.interleave !== true) {
    for (const [type, count] of entries) {
      for (let i = 0; i < count; i += 1) {
        ids.push(broker.send(type, payloadFor(type, i), spec.delayMs ?? 0));
      }
    }
    return ids;
  }

  // Round-robin the types so arrival order mixes, which is what makes lane fairness observable.
  const remaining = new Map(entries);
  const emitted = new Map(entries.map(([type]) => [type, 0]));
  while (remaining.size > 0) {
    for (const [type, count] of [...remaining]) {
      const index = emitted.get(type) ?? 0;
      ids.push(broker.send(type, payloadFor(type, index), spec.delayMs ?? 0));
      emitted.set(type, index + 1);
      if (index + 1 >= count) remaining.delete(type);
    }
  }
  return ids;
}

function payloadFor(type: JobType, index: number): Record<string, unknown> {
  switch (type) {
    case IMAGE:
      return { photoId: `photo-${index}`, correlationId: `img-${index}` };
    case PDF:
      return { albumId: `album-${index}`, token: `token-${index}`, correlationId: `pdf-${index}` };
    case CLEANUP:
      return { keys: [`u/albums/a/${index}.jpg`], correlationId: `cln-${index}` };
    default:
      return { index, correlationId: `${type}-${index}` };
  }
}

export interface SyntheticProcessorOptions {
  readonly type: JobType;
  /** Simulated work duration (ms). */
  readonly durationMs?: number;
  /** Fail every Nth job with a RETRYABLE error (rejects → nack → broker retry). */
  readonly failEveryNth?: number;
  /** Fail every Nth job TERMINALLY (resolves → ack, like a rejected photo). */
  readonly terminalEveryNth?: number;
  /** Retain this many bytes per job to model memory pressure; released when the job settles. */
  readonly retainBytesPerJob?: number;
  /** Faults injected around the work (shares the chaos controller with the adapters). */
  readonly faults?: FaultController;
}

/**
 * A processor that does no real work but behaves like one: it takes time, observes cancellation at
 * safe points, and can fail retryably or terminally on a deterministic schedule.
 */
export class SyntheticProcessor implements Processor {
  readonly type: JobType;
  /** Every job id this processor STARTED — the duplicate-processing assertion. */
  readonly started: string[] = [];
  /** Every job id it COMPLETED. */
  readonly completed: string[] = [];
  /** Highest number of simultaneous executions — proves the lane cap was honoured. */
  private peak = 0;
  private active = 0;
  private seen = 0;
  private readonly ballast: Uint8Array[] = [];

  constructor(private readonly options: SyntheticProcessorOptions) {
    this.type = options.type;
  }

  get peakConcurrency(): number {
    return this.peak;
  }

  get activeNow(): number {
    return this.active;
  }

  async process(job: Job, cancellation?: CancellationToken): Promise<void> {
    this.started.push(job.id);
    this.seen += 1;
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);

    const retained = this.options.retainBytesPerJob;
    if (retained !== undefined && retained > 0) this.ballast.push(new Uint8Array(retained));

    try {
      await this.options.faults?.intercept(this.type, 'process');
      cancellation?.throwIfCancelled();

      const duration = this.options.durationMs ?? 0;
      if (duration > 0) {
        // Sleep in slices so cancellation is observed promptly — the same cooperative granularity a
        // real multi-stage pipeline provides.
        const slice = Math.max(1, Math.min(5, duration));
        for (let elapsed = 0; elapsed < duration; elapsed += slice) {
          cancellation?.throwIfCancelled();
          await sleep(slice);
        }
      }
      cancellation?.throwIfCancelled();

      if (this.options.failEveryNth !== undefined && this.seen % this.options.failEveryNth === 0) {
        throw new Error(`synthetic transient failure on ${job.id}`);
      }
      if (
        this.options.terminalEveryNth !== undefined &&
        this.seen % this.options.terminalEveryNth === 0
      ) {
        return; // handled-terminal: resolves, so the loop ACKs — no retry
      }
      this.completed.push(job.id);
    } finally {
      this.active -= 1;
      if (retained !== undefined && retained > 0) this.ballast.pop();
    }
  }

  /** Job ids started more than once — must be empty except where a retry is expected. */
  duplicates(): readonly string[] {
    const counts = new Map<string, number>();
    for (const id of this.started) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  }
}

/** True when the error came from cooperative cancellation rather than a real failure. */
export function isCancellation(error: unknown): boolean {
  return error instanceof CancellationError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
