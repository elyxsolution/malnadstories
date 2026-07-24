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
 */
export interface QueueAdapter {
  poll(): Promise<WorkerJob | null>;
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
