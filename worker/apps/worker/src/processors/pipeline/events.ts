import type { StructuredLogger } from '@workerv2/worker-runtime';

/**
 * PROCESSOR EVENTS — the generic, structured lifecycle every processor emits as it runs a pipeline:
 * `processor.started → (stage.started → stage.completed|stage.failed)* → processor.completed|failed`.
 * The model is domain-agnostic (image, PDF, and future processors emit the same events), carries no UI
 * and exposes no API.
 *
 * Phase I-4 promoted this from "a seam later phases can consume" to THE instrumentation channel of the
 * worker. Processing components now emit events and NOTHING else: the Observability layer's
 * `ObservabilityEventSink` is the single consumer that turns this one stream into structured logs,
 * metrics, and trace spans. That is why the terminal-outcome members below were added — a processor
 * that used to hand-log "photo rejected" now states it once, as an event, and the observability layer
 * decides that it is a `warn` log, a `worker.processor.rejected` counter, and a span attribute.
 *
 * The additions are purely ADDITIVE: every pre-existing member, field, and consumer is unchanged.
 */

export type ProcessorEventType =
  | 'processor.started'
  | 'processor.completed'
  | 'processor.failed'
  // Terminal outcomes that are NOT pipeline completions (Phase I-4). They exist because "the job
  // ended" and "the pipeline ran to the end" are different facts, and only the processor knows which:
  //   • skipped  — an idempotent no-op: already done, superseded, or owned by a newer request.
  //   • rejected — permanently invalid INPUT (corrupt upload, poison payload). Acked, never retried.
  //   • result   — the domain outcome detail the generic pipeline cannot know (image dimensions,
  //                the object key written). Complements the pipeline's timing-only `completed`.
  | 'processor.skipped'
  | 'processor.rejected'
  | 'processor.result'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.failed'
  // Recovery layer (Phase I-3) — emitted by the Recovery Coordinator, generic + future-consumable.
  | 'recovery.started'
  | 'recovery.completed'
  | 'recovery.failed'
  // One per completed sweep (Phase I-4), carrying the aggregate totals + duration.
  | 'recovery.sweep'
  | 'cleanup.started'
  | 'cleanup.completed'
  | 'cleanup.failed';

export interface ProcessorEvent {
  readonly type: ProcessorEventType;
  /** The processor / job type (e.g. `image-hardening`, `album-pdf`). */
  readonly processor: string;
  /** Correlates every event of one run across app + worker. */
  readonly correlationId: string;
  /** The stage name, for `stage.*` events. */
  readonly stage?: string;
  /** Elapsed time for a completed/failed stage, or total for `processor.completed|failed`. */
  readonly durationMs?: number;
  /** Failure message, for `*.failed`. */
  readonly error?: string;
  /** Small, non-sensitive detail bag (ids, counts). */
  readonly detail?: Record<string, unknown>;
  /** ISO-8601 emission time. */
  readonly at: string;
}

/** Where processor events go. Implementations must never throw — observability is best-effort. */
export interface ProcessorEventSink {
  emit(event: ProcessorEvent): void;
}

/** Discards every event (tests / opt-out). */
export class NoopEventSink implements ProcessorEventSink {
  emit(): void {
    /* no-op */
  }
}

/**
 * Bridges processor events to the structured logger: `stage.*` at debug (fine-grained progress),
 * `processor.*` at info, `*.rejected` and any `*.failed` at warning.
 *
 * This is the MINIMAL sink — logs only. It remains for components constructed without the full
 * observability layer (unit tests, and any embedding that wants nothing but a log stream). The
 * production composition injects `ObservabilityEventSink` instead, which additionally derives
 * metrics and trace spans from the same events.
 */
export class LoggingEventSink implements ProcessorEventSink {
  constructor(private readonly logger: StructuredLogger) {}

  emit(event: ProcessorEvent): void {
    const level = event.type.endsWith('.failed')
      ? 'warning'
      : event.type.endsWith('.rejected')
        ? 'warning'
        : event.type.startsWith('stage.')
          ? 'debug'
          : 'info';
    this.logger.log({
      level,
      message: event.type,
      detail: {
        processor: event.processor,
        correlationId: event.correlationId,
        ...(event.stage === undefined ? {} : { stage: event.stage }),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.error === undefined ? {} : { error: event.error }),
        ...(event.detail ?? {}),
      },
    });
  }
}
