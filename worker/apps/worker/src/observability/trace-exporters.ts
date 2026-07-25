import type { WorkerLogger } from './logging.js';
import type { FinishedSpan, SpanExporter } from './tracing.js';

/**
 * SPAN EXPORTERS — the replaceable tracing backends. Today: a logging exporter (spans become
 * structured log records, so traces are visible with zero extra infrastructure) and an in-memory
 * exporter (assertions + the diagnostics endpoint). An OpenTelemetry/Jaeger/Tempo exporter is a
 * drop-in implementation of the same one-method interface — no processor, pipeline, or runtime code
 * changes when the tracing backend does.
 */

/** Emits each finished span as a structured `trace.span` record at debug level. */
export class LoggingSpanExporter implements SpanExporter {
  constructor(private readonly logger: WorkerLogger) {}

  export(span: FinishedSpan): void {
    // The level check is done by the logger; building the detail bag is cheap and only reached for
    // spans that were actually sampled.
    if (!this.logger.isEnabled('debug')) return;
    this.logger.debug('trace.span', {
      name: span.name,
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      ...(span.context.parentSpanId === undefined
        ? {}
        : { parentSpanId: span.context.parentSpanId }),
      durationMs: span.durationMs,
      status: span.status,
      ...(span.error === undefined ? {} : { error: span.error }),
      ...span.attributes,
    });
  }
}

/** Retains the most recent finished spans in a bounded ring (tests + `/diagnostics`). */
export class MemorySpanExporter implements SpanExporter {
  private readonly buffer: FinishedSpan[] = [];

  constructor(private readonly capacity = 200) {}

  export(span: FinishedSpan): void {
    this.buffer.push(span);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  get spans(): readonly FinishedSpan[] {
    return this.buffer;
  }

  /** Every span of one trace, in completion order (children finish before their parent). */
  trace(traceId: string): readonly FinishedSpan[] {
    return this.buffer.filter((s) => s.context.traceId === traceId);
  }

  /** Span names in completion order — the readable assertion for a pipeline's span shape. */
  get names(): readonly string[] {
    return this.buffer.map((s) => s.name);
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/** Fans spans out to several exporters, isolating failures. */
export class MultiSpanExporter implements SpanExporter {
  constructor(private readonly exporters: readonly SpanExporter[]) {}

  export(span: FinishedSpan): void {
    for (const exporter of this.exporters) {
      try {
        exporter.export(span);
      } catch {
        /* isolate exporter failures from each other */
      }
    }
  }
}

/** Discards every span. */
export class NoopSpanExporter implements SpanExporter {
  export(): void {}
}
