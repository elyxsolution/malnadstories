import PgBoss from 'pg-boss';
import type { Job } from '../../job.js';
import type { QueueAdapter } from '../../queue.js';
import type { QueueInfraConfig } from '../config.js';

/**
 * PG-BOSS QUEUE ADAPTER — the production `QueueAdapter<Job>` backed by pg-boss (Postgres-native jobs,
 * no Redis). It bridges the app's existing enqueue side (`src/lib/queue.ts`, which already sends onto
 * these queues) to the worker's generic `Job` envelope. It satisfies the SAME `poll`/`ack`/`nack`
 * contract as the in-memory queue, so a future consume loop swaps brokers with zero call-site change.
 *
 * DURABILITY, RETRIES, DEDUPE: all owned by pg-boss. A job survives worker restarts (it lives in
 * Postgres); `nack` → `boss.fail`, which re-queues per the job's own retry policy (set by the producer
 * at enqueue time) or dead-letters when attempts are exhausted. The adapter adds no retry state of its
 * own — it is a faithful, thin translation.
 *
 * The adapter depends on a minimal structural `PgBossLike` port (not the concrete class) so it is unit
 * tested against a fake with no database. `fromConnectionString` builds the real client. This phase
 * only PREPARES the adapter (connect/health/close are production-ready) — nothing consumes from it yet.
 */

/** pg-boss job as delivered with `includeMetadata: true` (the subset this adapter reads). */
export interface PgBossJobWithMetadata<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly retryCount: number;
  readonly createdOn: Date;
  readonly singletonKey: string | null;
}

/** pg-boss graceful-stop options (the subset this adapter uses). */
export interface PgBossStopOptions {
  readonly graceful?: boolean;
  readonly wait?: boolean;
}

/**
 * The minimal pg-boss surface this adapter needs — the structural seam that keeps the concrete client
 * injectable and the adapter unit-testable. Every method maps 1:1 to a pg-boss v10 method with an
 * identical signature.
 */
export interface PgBossLike {
  start(): Promise<unknown>;
  stop(options?: PgBossStopOptions): Promise<void>;
  createQueue(name: string): Promise<void>;
  fetch<T>(
    name: string,
    options: { includeMetadata: true; batchSize?: number },
  ): Promise<PgBossJobWithMetadata<T>[]>;
  send(name: string, data: object): Promise<string | null>;
  complete(name: string, id: string): Promise<void>;
  fail(name: string, id: string, data: object): Promise<void>;
}

export type QueueHealth = 'healthy' | 'unhealthy';

/** The PRODUCE side of the broker — used by the recovery layer to re-drive stale jobs. */
export interface JobProducer {
  enqueue(queue: string, payload: object): Promise<void>;
}

export class PgBossQueueAdapter implements QueueAdapter<Job>, JobProducer {
  /** Maps an in-flight job id → the queue it came from, so ack/nack target the right queue. */
  private readonly queueOfJob = new Map<string, string>();
  /** Round-robin position across the responsible queues — the anti-starvation state. */
  private cursor = 0;
  private started = false;

  constructor(
    private readonly boss: PgBossLike,
    private readonly queues: readonly string[],
  ) {}

  /** Build an adapter over a real pg-boss client from the queue config. */
  static fromConfig(config: QueueInfraConfig): PgBossQueueAdapter {
    const boss = new PgBoss({
      connectionString: config.connectionString,
      application_name: config.applicationName,
      // The worker is the CONSUMER: it supervises queue maintenance (the app enqueues send-only).
      supervise: true,
      schedule: false,
    });
    return new PgBossQueueAdapter(boss as unknown as PgBossLike, config.queues);
  }

  /** Start pg-boss and idempotently declare every responsible queue. Idempotent across calls. */
  async connect(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    for (const queue of this.queues) {
      await this.boss.createQueue(queue);
    }
    this.started = true;
  }

  /**
   * Report broker connectivity. A successful `connect()` (start + migrate + createQueue) already
   * proves the Postgres round-trip, so readiness reduces to "started"; a not-yet-connected adapter is
   * unhealthy by definition.
   */
  async healthCheck(): Promise<QueueHealth> {
    return this.started ? 'healthy' : 'unhealthy';
  }

  /**
   * Poll the responsible queues ROUND-ROBIN and return the first available job as a `Job` envelope,
   * or `null` when all are empty. Remembers the job→queue mapping for ack/nack.
   *
   * FAIRNESS (Phase I-5 fix). This previously scanned `this.queues` in DECLARED order and returned
   * the first hit. Because `image-hardening` is declared first, any standing backlog on it meant
   * `album-pdf` and `r2-cleanup` were never reached — a customer's PDF could wait behind thousands
   * of uploads indefinitely. Starvation was invisible in normal operation because the queues are
   * usually near-empty; it only appears under exactly the load this phase validates.
   *
   * The cursor advances past whichever queue was served, so over any window of N polls each of the
   * N queues gets a turn. It is deliberately a plain rotation rather than a weighted or
   * priority scheme: fairness is the property being fixed, and anything cleverer would be an
   * unvalidated policy.
   *
   * `filter` restricts the poll to job types whose concurrency lane still has room.
   */
  async poll(filter?: readonly string[]): Promise<Job | null> {
    const eligible =
      filter === undefined ? this.queues : this.queues.filter((q) => filter.includes(q));
    if (eligible.length === 0) return null;

    for (let i = 0; i < eligible.length; i += 1) {
      const queue = eligible[(this.cursor + i) % eligible.length] as string;
      const jobs = await this.boss.fetch<Record<string, unknown>>(queue, {
        includeMetadata: true,
        batchSize: 1,
      });
      const raw = jobs[0];
      if (raw !== undefined) {
        this.cursor = (this.cursor + i + 1) % eligible.length;
        this.queueOfJob.set(raw.id, queue);
        return toJob(raw, queue);
      }
    }
    return null;
  }

  /** Enqueue a job onto `queue` (the produce side — recovery re-drives stale work through this). */
  async enqueue(queue: string, payload: object): Promise<void> {
    await this.boss.send(queue, payload);
  }

  /** Acknowledge success — completes the pg-boss job on its originating queue. */
  async ack(jobId: string): Promise<void> {
    const queue = this.requireQueue(jobId);
    await this.boss.complete(queue, jobId);
    this.queueOfJob.delete(jobId);
  }

  /** Acknowledge failure — fails the pg-boss job, which re-queues it per its retry policy or dead-letters it. */
  async nack(jobId: string, error: unknown): Promise<void> {
    const queue = this.requireQueue(jobId);
    await this.boss.fail(queue, jobId, { message: errorMessage(error) });
    this.queueOfJob.delete(jobId);
  }

  /** Graceful shutdown: let pg-boss finish in-flight work, then stop. Idempotent. */
  async close(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, wait: true });
    this.started = false;
    this.queueOfJob.clear();
  }

  /** Jobs polled but not yet acked/nacked by this adapter (an operational gauge). */
  get inFlight(): number {
    return this.queueOfJob.size;
  }

  private requireQueue(jobId: string): string {
    const queue = this.queueOfJob.get(jobId);
    if (queue === undefined) {
      throw new Error(`Unknown job id "${jobId}" — not polled by this adapter (already acked?)`);
    }
    return queue;
  }
}

/** Map a pg-boss job (queue name + payload + metadata) into the generic `Job` envelope. */
function toJob(raw: PgBossJobWithMetadata<Record<string, unknown>>, queue: string): Job {
  const correlation = raw.data['correlationId'];
  return {
    id: raw.id,
    type: queue,
    payload: raw.data,
    metadata: {
      correlationId:
        typeof correlation === 'string' && correlation.length > 0 ? correlation : raw.id,
      attempt: raw.retryCount + 1,
    },
    enqueuedAt: raw.createdOn.toISOString(),
    receivedAt: new Date().toISOString(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
