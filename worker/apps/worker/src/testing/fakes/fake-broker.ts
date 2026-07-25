import type { Job, JobType } from '../../job.js';
import type { QueueAdapter } from '../../queue.js';

/**
 * THE FAKE BROKER — an in-memory model of pg-boss, faithful to the properties the worker actually
 * depends on, so queue behaviour can be validated without a Postgres instance.
 *
 * It exists because the real correctness questions of Phase I-5 are about the BROKER CONTRACT, not
 * about SQL: does an atomic fetch stop two workers taking the same job? does a nack re-queue until
 * the retry limit and then dead-letter? does an unacked job from a crashed worker come back? Those
 * are all decidable against a faithful model, deterministically and in milliseconds, which is what
 * makes them viable as regression tests rather than a manual exercise.
 *
 * MODELLED FAITHFULLY (these are the pg-boss guarantees the worker relies on):
 *   • ATOMIC FETCH — a job is handed to exactly one consumer. This is pg-boss's `SKIP LOCKED`
 *     behaviour, and it is the single assumption on which multi-worker correctness rests. Because
 *     JavaScript runs the fetch body without interleaving, taking from the array IS atomic here.
 *   • VISIBILITY TIMEOUT — a fetched-but-unacked job returns to the queue after `visibilityMs`.
 *     This is what makes a worker crash safe, and what makes an abandoned drain safe.
 *   • RETRY + DEAD-LETTER — `fail` re-queues until `retryLimit`, then moves the job to the dead
 *     letter list rather than losing it or looping forever.
 *   • DELAYED JOBS — `startAfter` withholds a job until its time arrives.
 *
 * DELIBERATELY NOT MODELLED: SQL, connection pooling, and pg-boss's maintenance/archival. Those are
 * the library's own responsibility and are covered by its own test suite; modelling them here would
 * be testing pg-boss rather than the worker.
 */

export interface FakeBrokerOptions {
  /** How long a fetched job stays invisible before returning to the queue (crash recovery). */
  readonly visibilityMs?: number;
  /** Deliveries allowed per job before it is dead-lettered. */
  readonly retryLimit?: number;
  /** Injectable clock, so visibility timeouts are deterministic in tests. */
  readonly now?: () => number;
}

interface BrokerJob {
  readonly id: string;
  readonly queue: JobType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: number;
  /** Withheld until this time (delayed jobs). */
  startAfter: number;
  /** Deliveries so far; 0 until first fetched. */
  deliveries: number;
  /** Set while a consumer holds the job; it becomes visible again at this time. */
  invisibleUntil: number | null;
  /** Which consumer currently holds it (for isolation assertions). */
  heldBy: string | null;
}

export interface DeadLetter {
  readonly id: string;
  readonly queue: JobType;
  readonly payload: Record<string, unknown>;
  readonly deliveries: number;
  readonly lastError: string;
}

/** A record of every delivery, so tests can prove no duplicate PROCESSING occurred. */
export interface DeliveryRecord {
  readonly jobId: string;
  readonly queue: JobType;
  readonly consumer: string;
  readonly attempt: number;
  readonly at: number;
}

export class FakeBroker {
  private readonly jobs = new Map<string, BrokerJob>();
  private readonly order: string[] = [];
  private readonly dead: DeadLetter[] = [];
  private readonly deliveries: DeliveryRecord[] = [];
  private readonly completed = new Set<string>();
  private readonly visibilityMs: number;
  private readonly retryLimit: number;
  private readonly now: () => number;
  private nextId = 0;

  constructor(options: FakeBrokerOptions = {}) {
    this.visibilityMs = options.visibilityMs ?? 30_000;
    this.retryLimit = options.retryLimit ?? 3;
    this.now = options.now ?? ((): number => Date.now());
  }

  // --- Produce side --------------------------------------------------------------------------

  /** Enqueue one job; returns its broker id. `delayMs` models pg-boss `startAfter`. */
  send(queue: JobType, payload: Record<string, unknown> = {}, delayMs = 0): string {
    const id = `job-${(this.nextId += 1)}`;
    const at = this.now();
    this.jobs.set(id, {
      id,
      queue,
      payload,
      createdAt: at,
      startAfter: at + delayMs,
      deliveries: 0,
      invisibleUntil: null,
      heldBy: null,
    });
    this.order.push(id);
    return id;
  }

  /** Enqueue `count` jobs onto `queue`. Returns their ids. */
  sendMany(
    queue: JobType,
    count: number,
    payload: (i: number) => Record<string, unknown>,
  ): string[] {
    return Array.from({ length: count }, (_, i) => this.send(queue, payload(i)));
  }

  // --- Consume side --------------------------------------------------------------------------

  /**
   * Atomically take the next visible job from `queue`, or `null`. Synchronous by construction:
   * because JS does not interleave inside this body, "take from the array" IS the atomic
   * `SKIP LOCKED` fetch, which is exactly the property multi-worker correctness depends on.
   */
  fetch(queue: JobType, consumer: string): BrokerJob | null {
    const at = this.now();
    this.releaseExpired(at);
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (job === undefined) continue;
      if (job.queue !== queue) continue;
      if (job.invisibleUntil !== null) continue; // held by another consumer
      if (job.startAfter > at) continue; // delayed
      job.deliveries += 1;
      job.invisibleUntil = at + this.visibilityMs;
      job.heldBy = consumer;
      this.deliveries.push({
        jobId: id,
        queue,
        consumer,
        attempt: job.deliveries,
        at,
      });
      return job;
    }
    return null;
  }

  /** Acknowledge success: the job is removed for good. */
  complete(id: string): void {
    this.completed.add(id);
    this.remove(id);
  }

  /** Acknowledge failure: re-queue until the retry limit, then dead-letter. */
  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    if (job.deliveries >= this.retryLimit) {
      this.dead.push({
        id: job.id,
        queue: job.queue,
        payload: job.payload,
        deliveries: job.deliveries,
        lastError: error,
      });
      this.remove(id);
      return;
    }
    job.invisibleUntil = null; // immediately visible again
    job.heldBy = null;
  }

  /**
   * Return every job whose visibility window has lapsed — the crashed-worker path. A worker that
   * dies mid-job never acks, so the broker hands the job to someone else and nothing is lost.
   */
  private releaseExpired(at: number): void {
    for (const job of this.jobs.values()) {
      if (job.invisibleUntil !== null && job.invisibleUntil <= at) {
        job.invisibleUntil = null;
        job.heldBy = null;
      }
    }
  }

  private remove(id: string): void {
    this.jobs.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) this.order.splice(index, 1);
  }

  // --- Inspection (assertions) ---------------------------------------------------------------

  /** Jobs still queued (visible or held). */
  get depth(): number {
    return this.jobs.size;
  }

  /** Jobs currently held by a consumer (in flight). */
  get inFlight(): number {
    return [...this.jobs.values()].filter((j) => j.invisibleUntil !== null).length;
  }

  depthOf(queue: JobType): number {
    return [...this.jobs.values()].filter((j) => j.queue === queue).length;
  }

  get completedIds(): readonly string[] {
    return [...this.completed];
  }

  get deadLetters(): readonly DeadLetter[] {
    return this.dead;
  }

  get deliveryLog(): readonly DeliveryRecord[] {
    return this.deliveries;
  }

  /** How many times each job was DELIVERED. >1 is legal (retry); the test asserts on processing. */
  deliveryCount(jobId: string): number {
    return this.deliveries.filter((d) => d.jobId === jobId).length;
  }

  /** Job ids delivered to more than one consumer SIMULTANEOUSLY — must always be empty. */
  concurrentDoubleDelivery(): readonly string[] {
    const open = new Map<string, string>();
    const offenders: string[] = [];
    for (const delivery of this.deliveries) {
      const holder = open.get(delivery.jobId);
      if (holder !== undefined && holder !== delivery.consumer) offenders.push(delivery.jobId);
      open.set(delivery.jobId, delivery.consumer);
    }
    return offenders;
  }

  /** Per-consumer delivery counts — the queue-distribution assertion for multi-worker runs. */
  distribution(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const delivery of this.deliveries) {
      out[delivery.consumer] = (out[delivery.consumer] ?? 0) + 1;
    }
    return out;
  }
}

/**
 * A `QueueAdapter` over the fake broker — the seam that lets a REAL `WorkerApplication` consume from
 * the model. Each adapter carries a distinct `consumer` id, which is how N adapters over ONE broker
 * model N workers competing for the same queues.
 *
 * Polling is ROUND-ROBIN across the responsible queues and honours the optional type filter, exactly
 * like the production pg-boss adapter — the fake must not be fairer than the real thing, or the
 * fairness tests would prove nothing about production.
 */
export class FakeBrokerQueue implements QueueAdapter<Job> {
  private cursor = 0;
  private readonly queueOfJob = new Map<string, JobType>();

  constructor(
    private readonly broker: FakeBroker,
    private readonly queues: readonly JobType[],
    readonly consumer = 'worker-1',
  ) {}

  async poll(filter?: readonly JobType[]): Promise<Job | null> {
    const eligible =
      filter === undefined ? this.queues : this.queues.filter((q) => filter.includes(q));
    for (let i = 0; i < eligible.length; i += 1) {
      const queue = eligible[(this.cursor + i) % eligible.length] as JobType;
      const raw = this.broker.fetch(queue, this.consumer);
      if (raw !== null) {
        this.cursor = (this.cursor + i + 1) % eligible.length; // advance past the served queue
        this.queueOfJob.set(raw.id, queue);
        return {
          id: raw.id,
          type: queue,
          payload: raw.payload,
          metadata: {
            correlationId:
              typeof raw.payload['correlationId'] === 'string'
                ? (raw.payload['correlationId'] as string)
                : raw.id,
            attempt: raw.deliveries,
          },
          enqueuedAt: new Date(raw.createdAt).toISOString(),
          receivedAt: new Date().toISOString(),
        };
      }
    }
    return null;
  }

  async ack(jobId: string): Promise<void> {
    this.broker.complete(jobId);
    this.queueOfJob.delete(jobId);
  }

  async nack(jobId: string, error: unknown): Promise<void> {
    this.broker.fail(jobId, error instanceof Error ? error.message : String(error));
    this.queueOfJob.delete(jobId);
  }
}
