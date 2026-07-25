import type { ProcessorEvent, ProcessorEventSink } from '../processors/pipeline/events.js';
import type { WorkerLogger } from './logging.js';
import type { MetricsProvider } from './metrics.js';
import { WORKER_METRICS } from './metric-names.js';
import type { LogLevel, ObservabilityFields } from './model.js';
import type { Span, Tracer } from './tracing.js';

/**
 * THE SINGLE INSTRUMENTATION POINT.
 *
 * This is the architectural centre of Phase I-4. Every processor, pipeline, stage and recovery
 * handler already emits a structured `ProcessorEvent` (Phase I-2/I-3). This sink is the ONE place
 * that turns that stream into all three observability signals:
 *
 *                                     ┌─▶ structured LOGS   (severity + correlated fields)
 *     Processor / Pipeline / Recovery ─┼─▶ METRICS           (counters + timings, low cardinality)
 *          (emits events only)         └─▶ TRACES           (root span per job, child span per stage)
 *
 * Why this shape:
 *   • NO DUPLICATE INSTRUMENTATION. A processor that logged, counted and traced its own work would
 *     state the same fact three times, and drift three ways. Here it states it ONCE, as an event.
 *   • NO BACKEND COUPLING. Processors import no logger, no metrics client, no tracer. Swapping
 *     Prometheus in, or OpenTelemetry, changes the provider passed to this constructor and nothing
 *     else in the codebase.
 *   • TRACES FOR FREE. Because the event stream already brackets every stage
 *     (`stage.started` → `stage.completed | stage.failed`), spans can be SYNTHESISED from it. No
 *     processor was modified to be traced; the shape of the trace is exactly the shape of the
 *     pipeline. An image job yields `image-hardening → loading → validating → decoding → …`, and a
 *     PDF job yields `album-pdf → validate → snapshot → prepare → render → upload → finalize`.
 *
 * MEMORY SAFETY. Span state is keyed by `correlationId` and released on every terminal event. A
 * processor that somehow never emits a terminal event cannot leak: the map is hard-capped and
 * evicts (and closes) the oldest trace once full.
 *
 * PERFORMANCE. Nothing is allocated for a signal that will not be recorded — the logger's level
 * check gates record construction, and a disabled tracer returns a shared no-op span. Metric tags
 * are drawn only from low-cardinality fields (processor, stage, outcome); ids never become tags.
 */

/** Bounded number of concurrently open traces (guards against a processor that never terminates). */
const MAX_OPEN_TRACES = 512;

interface TraceState {
  readonly root: Span;
  readonly stages: Map<string, Span>;
  readonly startedAt: number;
}

export interface ObservabilityEventSinkDeps {
  readonly logger: WorkerLogger;
  readonly metrics: MetricsProvider;
  readonly tracer: Tracer;
  /** Injectable clock (deterministic tests). */
  readonly now?: () => number;
}

export class ObservabilityEventSink implements ProcessorEventSink {
  private readonly logger: WorkerLogger;
  private readonly metrics: MetricsProvider;
  private readonly tracer: Tracer;
  private readonly now: () => number;
  private readonly traces = new Map<string, TraceState>();

  constructor(deps: ObservabilityEventSinkDeps) {
    this.logger = deps.logger;
    this.metrics = deps.metrics;
    this.tracer = deps.tracer;
    this.now = deps.now ?? ((): number => Date.now());
  }

  /** Open traces right now — a leak canary for tests and `/diagnostics`. */
  get openTraces(): number {
    return this.traces.size;
  }

  /**
   * Fan one event out to logs, metrics, and traces. NEVER throws: an observability failure must not
   * fail the job that produced the event.
   */
  emit(event: ProcessorEvent): void {
    try {
      this.dispatch(event);
    } catch {
      /* best-effort by contract — see ProcessorEventSink */
    }
  }

  private dispatch(event: ProcessorEvent): void {
    const tags = { processor: event.processor };

    switch (event.type) {
      // --- Processor lifecycle -------------------------------------------------------------------
      case 'processor.started': {
        const root = this.tracer.startSpan(event.processor, {
          attributes: { processor: event.processor, correlationId: event.correlationId },
        });
        this.traces.set(event.correlationId, {
          root,
          stages: new Map(),
          startedAt: this.now(),
        });
        this.evictIfOverCapacity();
        this.metrics.counter(WORKER_METRICS.processorStarted, 1, tags);
        this.write('info', event, root);
        return;
      }

      case 'processor.completed': {
        const state = this.traces.get(event.correlationId);
        this.metrics.counter(WORKER_METRICS.processorCompleted, 1, tags);
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.processorDurationMs, event.durationMs, tags);
        }
        this.write('info', event, state?.root);
        this.closeTrace(event.correlationId, 'ok');
        return;
      }

      case 'processor.failed': {
        const state = this.traces.get(event.correlationId);
        state?.root.recordError(event.error ?? 'processor failed');
        this.metrics.counter(WORKER_METRICS.processorFailed, 1, tags);
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.processorDurationMs, event.durationMs, tags);
        }
        this.write('error', event, state?.root);
        this.closeTrace(event.correlationId, 'error');
        return;
      }

      /**
       * A terminal NO-OP: the work was already done, superseded, or belongs to a newer request.
       * Expected and healthy (idempotent redelivery), so it is `info`, not a failure.
       */
      case 'processor.skipped': {
        const state = this.traces.get(event.correlationId);
        state?.root.setAttribute('outcome', 'skipped');
        this.metrics.counter(WORKER_METRICS.processorSkipped, 1, {
          ...tags,
          reason: reasonTag(event),
        });
        this.write('info', event, state?.root);
        this.closeTrace(event.correlationId, 'ok');
        return;
      }

      /**
       * A terminal PERMANENT failure of the INPUT (a corrupt upload, a poison payload). The job is
       * acked, not retried. `warn`, not `error`: the system behaved correctly; the data did not.
       */
      case 'processor.rejected': {
        const state = this.traces.get(event.correlationId);
        state?.root.setAttribute('outcome', 'rejected');
        this.metrics.counter(WORKER_METRICS.processorRejected, 1, {
          ...tags,
          reason: reasonTag(event),
        });
        this.write('warn', event, state?.root);
        this.closeTrace(event.correlationId, 'ok');
        return;
      }

      /**
       * Terminal DOMAIN RESULT — the outcome detail a processor knows and the generic pipeline does
       * not (image dimensions, the object key written). Recorded as span attributes so it is
       * searchable per trace, and logged once. Does not close the trace.
       */
      case 'processor.result': {
        const state = this.traces.get(event.correlationId);
        if (state !== undefined && event.detail !== undefined) {
          state.root.setAttributes(attributesOf(event.detail));
        }
        this.write('info', event, state?.root);
        return;
      }

      // --- Stage lifecycle ------------------------------------------------------------------------
      case 'stage.started': {
        const state = this.traces.get(event.correlationId);
        if (state !== undefined && event.stage !== undefined) {
          const span = this.tracer.startSpan(event.stage, {
            parent: state.root,
            attributes: { processor: event.processor, stage: event.stage },
          });
          state.stages.set(event.stage, span);
          this.write('trace', event, span);
          return;
        }
        this.write('trace', event, state?.root);
        return;
      }

      case 'stage.completed': {
        const span = this.endStage(event, 'ok');
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.stageDurationMs, event.durationMs, stageTags(event));
        }
        this.metrics.counter(WORKER_METRICS.stageCompleted, 1, stageTags(event));
        this.write('debug', event, span);
        return;
      }

      case 'stage.failed': {
        const span = this.endStage(event, 'error', event.error);
        this.metrics.counter(WORKER_METRICS.stageFailed, 1, stageTags(event));
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.stageDurationMs, event.durationMs, stageTags(event));
        }
        this.write('warn', event, span);
        return;
      }

      // --- Recovery -------------------------------------------------------------------------------
      // Recovery gets its OWN trace per healed item: it is independent background work, not part of
      // any job's trace, and conflating them would make job traces unreadable.
      case 'recovery.started': {
        const span = this.tracer.startSpan(`recovery ${event.processor}`, {
          attributes: { processor: event.processor, correlationId: event.correlationId },
        });
        this.traces.set(event.correlationId, {
          root: span,
          stages: new Map(),
          startedAt: this.now(),
        });
        this.evictIfOverCapacity();
        this.metrics.counter(WORKER_METRICS.recoveryStaleDetected, 1, tags);
        this.write('debug', event, span);
        return;
      }

      case 'recovery.completed': {
        const state = this.traces.get(event.correlationId);
        const outcome = stringDetail(event, 'outcome') ?? 'unknown';
        state?.root.setAttribute('outcome', outcome);
        this.metrics.counter(WORKER_METRICS.recoveryOutcome, 1, { ...tags, outcome });
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.recoveryDurationMs, event.durationMs, tags);
        }
        // `abandoned` means work was permanently given up on — an operator wants to see that.
        this.write(outcome === 'abandoned' ? 'warn' : 'debug', event, state?.root);
        this.closeTrace(event.correlationId, 'ok');
        return;
      }

      case 'recovery.failed': {
        const state = this.traces.get(event.correlationId);
        state?.root.recordError(event.error ?? 'recovery failed');
        this.metrics.counter(WORKER_METRICS.recoveryFailed, 1, tags);
        this.write('warn', event, state?.root);
        this.closeTrace(event.correlationId, 'error');
        return;
      }

      case 'recovery.sweep': {
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.recoverySweepDurationMs, event.durationMs);
        }
        const backlog = numberDetail(event, 'detected');
        if (backlog !== null) this.metrics.gauge(WORKER_METRICS.recoveryBacklog, backlog);
        this.write('info', event, undefined);
        return;
      }

      // --- Cleanup ---------------------------------------------------------------------------------
      case 'cleanup.started':
        this.write('debug', event, this.traces.get(event.correlationId)?.root);
        return;

      case 'cleanup.completed': {
        const removed = numberDetail(event, 'deleted');
        if (removed !== null && removed > 0) {
          this.metrics.counter(WORKER_METRICS.cleanupObjectsRemoved, removed);
        }
        if (event.durationMs !== undefined) {
          this.metrics.timing(WORKER_METRICS.cleanupDurationMs, event.durationMs);
        }
        this.write('info', event, this.traces.get(event.correlationId)?.root);
        return;
      }

      case 'cleanup.failed':
        this.write('warn', event, this.traces.get(event.correlationId)?.root);
        return;

      default: {
        // Exhaustiveness guard: a future event type still gets logged rather than silently dropped.
        const unknown: never = event.type;
        this.write('info', { ...event, type: unknown }, undefined);
      }
    }
  }

  // --- Emission helpers ----------------------------------------------------------------------------

  /** Build the correlated log record for an event. The event's `type` IS the log message. */
  private write(level: LogLevel, event: ProcessorEvent, span: Span | undefined): void {
    if (!this.logger.isEnabled(level)) return; // skip all field/detail construction
    const fields: ObservabilityFields = {
      processor: event.processor,
      pipeline: event.processor,
      correlationId: event.correlationId,
      ...(event.stage === undefined ? {} : { stage: event.stage }),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(span === undefined || span.context.traceId === ''
        ? {}
        : { traceId: span.context.traceId, spanId: span.context.spanId }),
    };
    const detail =
      event.error === undefined ? event.detail : { ...(event.detail ?? {}), error: event.error };
    this.logger.record(level, event.type, fields, detail);
  }

  private endStage(
    event: ProcessorEvent,
    status: 'ok' | 'error',
    error?: string,
  ): Span | undefined {
    const state = this.traces.get(event.correlationId);
    if (state === undefined || event.stage === undefined) return state?.root;
    const span = state.stages.get(event.stage);
    if (span === undefined) return state.root;
    if (error !== undefined) span.recordError(error);
    else span.setStatus(status);
    span.end();
    state.stages.delete(event.stage);
    return span;
  }

  /** Close a trace: end any still-open stage spans, then the root. Always releases the map entry. */
  private closeTrace(correlationId: string, status: 'ok' | 'error'): void {
    const state = this.traces.get(correlationId);
    if (state === undefined) return;
    for (const span of state.stages.values()) span.end(); // an abandoned stage must not leak a span
    state.stages.clear();
    state.root.setStatus(status);
    state.root.end();
    this.traces.delete(correlationId);
  }

  /** Hard cap on open traces — evicts (and closes) the oldest so the map can never grow unbounded. */
  private evictIfOverCapacity(): void {
    if (this.traces.size <= MAX_OPEN_TRACES) return;
    const oldest = this.traces.keys().next();
    if (!oldest.done) this.closeTrace(oldest.value, 'error');
  }
}

// --- Small pure helpers ---------------------------------------------------------------------------

function stageTags(event: ProcessorEvent): Record<string, string> {
  return { processor: event.processor, stage: event.stage ?? 'unknown' };
}

/** A low-cardinality reason tag. Free-form reasons are bucketed by the detail's `reason` key only. */
function reasonTag(event: ProcessorEvent): string {
  return stringDetail(event, 'reason') ?? 'unspecified';
}

function stringDetail(event: ProcessorEvent, key: string): string | null {
  const value = event.detail?.[key];
  return typeof value === 'string' ? value : null;
}

function numberDetail(event: ProcessorEvent, key: string): number | null {
  const value = event.detail?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Project a detail bag onto span attributes, keeping only primitive (attribute-legal) values. */
function attributesOf(
  detail: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}
