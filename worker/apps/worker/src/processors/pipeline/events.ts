import type { StructuredLogger } from '@workerv2/worker-runtime';

/**
 * PROCESSOR EVENTS — the generic, structured lifecycle every processor emits as it runs a pipeline:
 * `processor.started → (stage.started → stage.completed|stage.failed)* → processor.completed|failed`.
 * The model is domain-agnostic (image, PDF, and future processors emit the same events), carries no UI
 * and exposes no API — it is purely an observability seam that later phases can consume (metrics,
 * tracing, a live progress feed). This phase only establishes the model + a logging sink.
 */

export type ProcessorEventType =
  | 'processor.started'
  | 'processor.completed'
  | 'processor.failed'
  | 'stage.started'
  | 'stage.completed'
  | 'stage.failed'
  // Recovery layer (Phase I-3) — emitted by the Recovery Coordinator, generic + future-consumable.
  | 'recovery.started'
  | 'recovery.completed'
  | 'recovery.failed'
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
 * `processor.*` at info, and any `*.failed` at warning. This is the default sink — it turns the event
 * stream into the exact progress/diagnostics logging each processor used to emit by hand.
 */
export class LoggingEventSink implements ProcessorEventSink {
  constructor(private readonly logger: StructuredLogger) {}

  emit(event: ProcessorEvent): void {
    const level = event.type.endsWith('.failed')
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
