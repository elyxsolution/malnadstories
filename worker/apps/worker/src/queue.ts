import type { Blueprint } from '@workerv2/blueprint';

/**
 * QUEUE INTEGRATION — production queue integration was intentionally DEFERRED in the architecture
 * (the runtime is queue-unaware, by design). This module provides the isolated seam: a `QueueAdapter`
 * interface plus a simple in-memory polling adapter. The runtime NEVER sees these details — the app's
 * consume loop polls the adapter and hands each job's Blueprint to `runtime.run(...)`. A real broker
 * (SQS / pg-boss / Redis) drops in behind the SAME interface without touching the runtime or the app
 * loop.
 */

/** One unit of work: an id + the album Blueprint to render (its source Artifacts already in storage). */
export interface WorkerJob {
  readonly id: string;
  readonly blueprint: Blueprint;
}

/**
 * The replaceable QUEUE ADAPTER. `poll` returns the next job or `null` when the queue is empty;
 * `ack`/`nack` acknowledge completion/failure. Kept minimal + broker-agnostic on purpose.
 *
 * `TJob` defaults to `WorkerJob` so the historical album-render loop (and every existing caller +
 * test) is unchanged: `QueueAdapter` still means `QueueAdapter<WorkerJob>`. A broker adapter that
 * delivers the generic `Job` envelope (see `./job.ts`) implements `QueueAdapter<Job>` behind the SAME
 * three-method contract — the parametrization is how one interface serves both the legacy blueprint
 * path and the generic job path without either knowing about the other.
 */
export interface QueueAdapter<TJob = WorkerJob> {
  /**
   * Take the next available job, or `null` when nothing is available.
   *
   * `filter` (Phase I-5, OPTIONAL) restricts the poll to the given job types. It exists because
   * adaptive concurrency needs to say "don't hand me another PDF, that lane is full" — and the only
   * correct place to express that is BEFORE taking the job from the broker. Taking a job and then
   * declining it would either burn a delivery attempt (nack) or hold a locked job idle, both of
   * which are worse than not asking for it.
   *
   * The parameter is optional and additive: an adapter that ignores it stays correct (it just
   * returns jobs the caller may have to run anyway), and every pre-Phase-I-5 caller is unchanged.
   */
  poll(filter?: readonly string[]): Promise<TJob | null>;
  ack(jobId: string): Promise<void>;
  nack(jobId: string, error: unknown): Promise<void>;
}

/**
 * A simple in-memory polling queue — the default adapter. It is production-SHAPED (FIFO, ack/nack)
 * but not durable; a real deployment injects a broker-backed adapter. With no jobs it returns `null`,
 * so the worker idles waiting for work.
 */
export class InMemoryQueue implements QueueAdapter {
  private readonly pending: WorkerJob[] = [];
  private readonly acked: string[] = [];
  private readonly nacked: string[] = [];

  /** Enqueue a job (a producer / test seam). */
  enqueue(job: WorkerJob): void {
    this.pending.push(job);
  }

  async poll(): Promise<WorkerJob | null> {
    return this.pending.shift() ?? null;
  }

  async ack(jobId: string): Promise<void> {
    this.acked.push(jobId);
  }

  async nack(jobId: string, _error: unknown): Promise<void> {
    this.nacked.push(jobId);
  }

  get depth(): number {
    return this.pending.length;
  }
  get ackedIds(): readonly string[] {
    return this.acked;
  }
  get nackedIds(): readonly string[] {
    return this.nacked;
  }
}
