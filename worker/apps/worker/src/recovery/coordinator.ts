import type { StructuredLogger } from '@workerv2/worker-runtime';
import type {
  ProcessorEvent,
  ProcessorEventSink,
  ProcessorEventType,
} from '../processors/pipeline/events.js';
import { CancellationError } from './cancellation.js';
import type { CancellationToken } from './cancellation.js';
import { METRICS } from './metrics.js';
import type { MetricsSink } from './metrics.js';
import type { RecoverableProcessor, RecoveryItem, RecoveryOutcome } from './recoverable.js';

/**
 * THE RECOVERY COORDINATOR — the single owner of reconciliation, healing, and recovery policy. It holds
 * a set of `RecoverableProcessor`s and, each sweep, asks every one for its stale work then heals each
 * item, emitting `recovery.*` events + metrics. It contains NO domain logic (nothing about photos, PDFs,
 * or R2) — that lives in the processors' recovery hooks — so it never changes as processors are added.
 *
 * The sweep is BOUNDED (each processor returns at most `batchSize` items — no full scans) and
 * CANCELLATION-AWARE (it stops promptly on shutdown). Every heal is idempotent, so a sweep that overlaps
 * a concurrent one, or re-runs after a crash, is always safe.
 */

export interface RecoveryCoordinatorDeps {
  readonly events: ProcessorEventSink;
  readonly metrics: MetricsSink;
  readonly logger: StructuredLogger;
  /** Max items healed per processor per sweep. */
  readonly batchSize: number;
}

export interface RecoverySummary {
  recovered: number;
  abandoned: number;
  alreadyHealed: number;
  skipped: number;
  failed: number;
}

export class RecoveryCoordinator {
  private readonly processors: RecoverableProcessor[] = [];

  constructor(private readonly deps: RecoveryCoordinatorDeps) {}

  /** Register a recoverable processor. New processors become recoverable with one call. */
  register(processor: RecoverableProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /** Run ONE recovery sweep across every processor. Returns aggregate outcomes. Never throws (except on cancel). */
  async runOnce(token: CancellationToken): Promise<RecoverySummary> {
    const sweepStart = Date.now();
    const totals: RecoverySummary = {
      recovered: 0,
      abandoned: 0,
      alreadyHealed: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      for (const processor of this.processors) {
        token.throwIfCancelled();
        await this.sweepProcessor(processor, token, totals);
      }
    } catch (error) {
      if (!(error instanceof CancellationError)) throw error;
      this.deps.logger.log({ level: 'info', message: 'recovery.cancelled', detail: { ...totals } });
    }

    this.deps.metrics.observe(METRICS.sweepDurationMs, Date.now() - sweepStart);
    this.deps.logger.log({ level: 'info', message: 'recovery.sweep', detail: { ...totals } });
    return totals;
  }

  private async sweepProcessor(
    processor: RecoverableProcessor,
    token: CancellationToken,
    totals: RecoverySummary,
  ): Promise<void> {
    let items: readonly RecoveryItem[];
    try {
      items = await processor.detectStale(this.deps.batchSize, token);
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      this.deps.logger.log({
        level: 'warning',
        message: 'recovery.detect_failed',
        detail: { processor: processor.name, error: toMessage(error) },
      });
      return;
    }
    if (items.length > 0) {
      this.deps.metrics.increment(METRICS.staleDetected, items.length, {
        processor: processor.name,
      });
    }

    for (const item of items) {
      token.throwIfCancelled();
      await this.healItem(processor, item, totals, token);
    }
  }

  private async healItem(
    processor: RecoverableProcessor,
    item: RecoveryItem,
    totals: RecoverySummary,
    token: CancellationToken,
  ): Promise<void> {
    const correlationId = `recovery:${processor.name}:${item.id}`;
    this.emit('recovery.started', processor.name, correlationId, { kind: item.kind, id: item.id });
    const start = Date.now();
    try {
      const result = await processor.recover(item, token);
      const durationMs = Date.now() - start;
      this.deps.metrics.observe(METRICS.recoveryDurationMs, durationMs, {
        processor: processor.name,
      });
      this.tally(totals, result.outcome, processor.name);
      this.emit('recovery.completed', processor.name, correlationId, {
        kind: item.kind,
        id: item.id,
        outcome: result.outcome,
        durationMs,
        ...(result.detail ?? {}),
      });
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      totals.failed += 1;
      this.emit('recovery.failed', processor.name, correlationId, {
        kind: item.kind,
        id: item.id,
        error: toMessage(error),
      });
      this.deps.logger.log({
        level: 'warning',
        message: 'recovery.item_failed',
        detail: { processor: processor.name, id: item.id, error: toMessage(error) },
      });
    }
  }

  private tally(totals: RecoverySummary, outcome: RecoveryOutcome, processor: string): void {
    switch (outcome) {
      case 'recovered':
        totals.recovered += 1;
        this.deps.metrics.increment(METRICS.jobsRecovered, 1, { processor });
        this.deps.metrics.increment(METRICS.retriesAttempted, 1, { processor });
        break;
      case 'abandoned':
        totals.abandoned += 1;
        this.deps.metrics.increment(METRICS.jobsAbandoned, 1, { processor });
        break;
      case 'already-healed':
        totals.alreadyHealed += 1;
        this.deps.metrics.increment(METRICS.jobsAlreadyHealed, 1, { processor });
        break;
      case 'skipped':
        totals.skipped += 1;
        this.deps.metrics.increment(METRICS.retriesSkipped, 1, { processor });
        break;
    }
  }

  private emit(
    type: ProcessorEventType,
    processor: string,
    correlationId: string,
    detail: Record<string, unknown>,
  ): void {
    const event: ProcessorEvent = {
      type,
      processor,
      correlationId,
      at: new Date().toISOString(),
      detail,
    };
    this.deps.events.emit(event);
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
