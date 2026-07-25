import type {
  ProcessorEvent,
  ProcessorEventSink,
  ProcessorEventType,
} from '../processors/pipeline/events.js';
import { CancellationError } from './cancellation.js';
import type { CancellationToken } from './cancellation.js';
import type { RecoverableProcessor, RecoveryItem, RecoveryOutcome } from './recoverable.js';

/**
 * THE RECOVERY COORDINATOR — the single owner of reconciliation, healing, and recovery policy. It holds
 * a set of `RecoverableProcessor`s and, each sweep, asks every one for its stale work then heals each
 * item, emitting `recovery.*` events. It contains NO domain logic (nothing about photos, PDFs, or R2) —
 * that lives in the processors' recovery hooks — so it never changes as processors are added.
 *
 * The sweep is BOUNDED (each processor returns at most `batchSize` items — no full scans) and
 * CANCELLATION-AWARE (it stops promptly on shutdown). Every heal is idempotent, so a sweep that overlaps
 * a concurrent one, or re-runs after a crash, is always safe.
 *
 * OBSERVABILITY (Phase I-4): this coordinator was previously instrumented THREE times over — for the same
 * facts it emitted an event, incremented a metric, AND wrote a log line, in three vocabularies that could
 * drift apart. It now emits ONLY events, and its `metrics` + `logger` dependencies are gone. The
 * Observability layer derives every counter, timing and log line from that one stream:
 *
 *     recovery.started   → `worker.recovery.stale_detected` + a span per healed item
 *     recovery.completed → `worker.recovery.outcome{outcome}` + `worker.recovery.duration_ms`
 *     recovery.failed    → `worker.recovery.failed` + an errored span
 *     recovery.sweep     → `worker.recovery.sweep_duration_ms` + the backlog gauge + the summary log
 *
 * The detect-failure and cancellation cases, which used to be bespoke log calls, are events too — so a
 * detection failure is finally visible in metrics rather than only in a log line.
 */

export interface RecoveryCoordinatorDeps {
  /** The single instrumentation channel. Everything this coordinator reports goes here. */
  readonly events: ProcessorEventSink;
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

/** The scope name used for sweep-level events, which belong to no single processor. */
const SWEEP_SCOPE = 'recovery';

export class RecoveryCoordinator {
  private readonly processors: RecoverableProcessor[] = [];
  private lastBacklog = 0;

  constructor(private readonly deps: RecoveryCoordinatorDeps) {}

  /** Register a recoverable processor. New processors become recoverable with one call. */
  register(processor: RecoverableProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /** Registered handler names, sorted — reported by `/diagnostics`. */
  get handlers(): readonly string[] {
    return this.processors.map((p) => p.name).sort();
  }

  /** Items detected by the most recent sweep — the source of the recovery-backlog gauge. */
  get backlog(): number {
    return this.lastBacklog;
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
    let detected = 0;
    let cancelled = false;

    try {
      for (const processor of this.processors) {
        token.throwIfCancelled();
        detected += await this.sweepProcessor(processor, token, totals);
      }
    } catch (error) {
      if (!(error instanceof CancellationError)) throw error;
      cancelled = true;
    }

    this.lastBacklog = detected;
    this.emit(
      'recovery.sweep',
      SWEEP_SCOPE,
      `sweep:${sweepStart}`,
      { ...totals, detected, ...(cancelled ? { cancelled: true } : {}) },
      Date.now() - sweepStart,
    );
    return totals;
  }

  /** Sweep one processor; returns how many stale items it reported. */
  private async sweepProcessor(
    processor: RecoverableProcessor,
    token: CancellationToken,
    totals: RecoverySummary,
  ): Promise<number> {
    let items: readonly RecoveryItem[];
    try {
      items = await processor.detectStale(this.deps.batchSize, token);
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      // A detection failure is a real fault (a bad query, a dead connection). It must be visible — but
      // it must not abort the sweep for the OTHER processors.
      this.emit('recovery.failed', processor.name, `detect:${processor.name}`, {
        phase: 'detect',
        error: toMessage(error),
      });
      return 0;
    }

    for (const item of items) {
      token.throwIfCancelled();
      await this.healItem(processor, item, totals, token);
    }
    return items.length;
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
      this.tally(totals, result.outcome);
      this.emit(
        'recovery.completed',
        processor.name,
        correlationId,
        { kind: item.kind, id: item.id, outcome: result.outcome, ...(result.detail ?? {}) },
        Date.now() - start,
      );
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      totals.failed += 1;
      this.emit(
        'recovery.failed',
        processor.name,
        correlationId,
        { phase: 'recover', kind: item.kind, id: item.id, error: toMessage(error) },
        Date.now() - start,
      );
    }
  }

  private tally(totals: RecoverySummary, outcome: RecoveryOutcome): void {
    switch (outcome) {
      case 'recovered':
        totals.recovered += 1;
        break;
      case 'abandoned':
        totals.abandoned += 1;
        break;
      case 'already-healed':
        totals.alreadyHealed += 1;
        break;
      case 'skipped':
        totals.skipped += 1;
        break;
    }
  }

  private emit(
    type: ProcessorEventType,
    processor: string,
    correlationId: string,
    detail: Record<string, unknown>,
    durationMs?: number,
  ): void {
    const event: ProcessorEvent = {
      type,
      processor,
      correlationId,
      at: new Date().toISOString(),
      ...(durationMs === undefined ? {} : { durationMs }),
      detail,
    };
    this.deps.events.emit(event);
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
