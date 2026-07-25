import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { Job } from '../../job.js';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import { CancellationError, NONE } from '../../recovery/cancellation.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import type { Processor } from '../registry.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { LoggingEventSink } from '../pipeline/events.js';
import type { ProcessorEvent, ProcessorEventSink, ProcessorEventType } from '../pipeline/events.js';
import type { CleanupContext, CleanupDeps } from './cleanup-context.js';
import { defaultCleanupStages } from './stages.js';

/** The r2-cleanup job type — matches the pg-boss queue the app enqueues onto. */
export const R2_CLEANUP_TYPE = 'r2-cleanup';

interface CleanupPayload {
  readonly keys: readonly string[];
}

export interface CleanupProcessorDeps {
  readonly objectStore: ObjectStore;
  readonly logger: StructuredLogger;
  readonly events?: ProcessorEventSink;
}

/**
 * THE CLEANUP PROCESSOR — deletes a batch of orphaned R2 objects for one `r2-cleanup` job. It emits the
 * semantic `cleanup.*` events and delegates the work to the composable cleanup pipeline. It is fully
 * idempotent: missing/already-deleted keys are no-ops, so duplicate delivery and retry-after-partial are
 * both safe. A transient failure (R2 blip) is rethrown so the broker retries (the app enqueues
 * r2-cleanup with retries) — cleanup never needs a "failed" terminal state.
 *
 * OBSERVABILITY (Phase I-4): the processor no longer records metrics itself. It carries the duration and
 * the delete count OUT on the `cleanup.completed` event, and the Observability layer derives the timing
 * and the objects-removed counter from it.
 */
export class CleanupProcessor implements Processor<CleanupPayload> {
  readonly type = R2_CLEANUP_TYPE;
  private readonly pipeline: Pipeline<CleanupContext, CleanupDeps>;
  private readonly events: ProcessorEventSink;

  constructor(deps: CleanupProcessorDeps) {
    this.events = deps.events ?? new LoggingEventSink(deps.logger);
    const cleanupDeps: CleanupDeps = {
      objectStore: deps.objectStore,
      logger: deps.logger,
    };
    this.pipeline = new Pipeline(defaultCleanupStages(), cleanupDeps, this.events);
  }

  async process(job: Job<CleanupPayload>, cancellation: CancellationToken = NONE): Promise<void> {
    const correlationId = job.metadata.correlationId;
    const keys = parseKeys(job.payload);
    if (keys === null) {
      // Poison payload — drop (ack).
      this.emit('processor.rejected', correlationId, { reason: 'bad_payload', jobId: job.id });
      return;
    }

    this.emit('cleanup.started', correlationId, { keys: keys.length });
    const start = Date.now();
    try {
      const ctx = await this.pipeline.run(
        { keys, deleted: 0 },
        { processor: R2_CLEANUP_TYPE, correlationId },
        cancellation,
      );
      this.emit('cleanup.completed', correlationId, { deleted: ctx.deleted }, Date.now() - start);
    } catch (error) {
      const cancelled = error instanceof CancellationError;
      this.emit(
        'cleanup.failed',
        correlationId,
        { ...(cancelled ? { reason: 'cancelled' } : { error: toMessage(error) }) },
        Date.now() - start,
      );
      throw error; // retryable (idempotent deletes make the retry safe); cancelled → redelivered later
    }
  }

  private emit(
    type: ProcessorEventType,
    correlationId: string,
    detail: Record<string, unknown>,
    durationMs?: number,
  ): void {
    const event: ProcessorEvent = {
      type,
      processor: R2_CLEANUP_TYPE,
      correlationId,
      at: new Date().toISOString(),
      ...(durationMs === undefined ? {} : { durationMs }),
      detail,
    };
    this.events.emit(event);
  }
}

/** Build the cleanup processor. */
export function createCleanupProcessor(deps: CleanupProcessorDeps): CleanupProcessor {
  return new CleanupProcessor(deps);
}

function parseKeys(payload: unknown): readonly string[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { keys?: unknown }).keys;
  if (!Array.isArray(value)) return null;
  return value.filter((k): k is string => typeof k === 'string');
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
