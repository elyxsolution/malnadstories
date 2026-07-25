import type { ObservabilityFields } from './model.js';
import { errorMessage, sanitizeValue } from './model.js';

/**
 * DISTRIBUTED TRACING — a backend-agnostic span model.
 *
 * A trace is one unit of work (a job, a recovery sweep); spans are its nested operations (stages,
 * resource acquisitions). The contracts here are deliberately close to the OpenTelemetry data model
 * — trace id, span id, parent, attributes, status, duration — WITHOUT depending on OpenTelemetry, so
 * an OTel/Jaeger/Tempo exporter is a `SpanExporter` implementation and nothing else changes.
 *
 * DESIGN CHOICE — explicit parenting, no ambient context. There is no `AsyncLocalStorage`-based
 * "current span": parents are passed explicitly. That keeps the tracer allocation-free on the hot
 * path, deterministic under test, and free of async-hooks overhead (which is measurable in a worker
 * that processes large images). The event sink (see `event-sink.ts`) holds the per-correlation span
 * stack, so processors still never touch a tracer.
 */

/** The identity of a span within a trace. */
export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

/** Terminal state of a span. */
export type SpanStatus = 'unset' | 'ok' | 'error';

/** Low-cardinality attributes attached to a span. */
export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;

/** A live span. `end()` is idempotent — double-ending is a no-op, never a crash. */
export interface Span {
  readonly context: SpanContext;
  readonly name: string;
  readonly ended: boolean;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: SpanAttributes): void;
  /** Mark the span failed and record the error's message (sanitized). */
  recordError(error: unknown): void;
  setStatus(status: SpanStatus): void;
  /** Close the span, compute its duration, and hand it to the exporter. */
  end(): void;
}

export interface StartSpanOptions {
  /** Parent span or context; omitted starts a new trace root. */
  readonly parent?: Span | SpanContext;
  readonly attributes?: SpanAttributes;
}

/** The tracing port. Implementations must never throw. */
export interface Tracer {
  startSpan(name: string, options?: StartSpanOptions): Span;
  /** Whether spans are actually recorded (lets a caller skip building attributes). */
  readonly enabled: boolean;
}

/** A completed span, as handed to an exporter. */
export interface FinishedSpan {
  readonly context: SpanContext;
  readonly name: string;
  /** Epoch ms when the span started. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly attributes: Record<string, string | number | boolean>;
  /** Sanitized error message when the span failed. */
  readonly error?: string;
}

/** Where finished spans go. A Jaeger/OTel/Tempo exporter implements exactly this. */
export interface SpanExporter {
  export(span: FinishedSpan): void;
}

// --- No-op (tracing disabled) -------------------------------------------------------------------

const NOOP_CONTEXT: SpanContext = { traceId: '', spanId: '' };

/** A shared, immutable span used when tracing is off — zero allocation per operation. */
export const NOOP_SPAN: Span = {
  context: NOOP_CONTEXT,
  name: '',
  ended: true,
  setAttribute: (): void => {},
  setAttributes: (): void => {},
  recordError: (): void => {},
  setStatus: (): void => {},
  end: (): void => {},
};

/** A tracer that records nothing. The default when `WV2_TRACING=off`. */
export class NoopTracer implements Tracer {
  readonly enabled = false;
  startSpan(_name: string, _options?: StartSpanOptions): Span {
    return NOOP_SPAN;
  }
}

// --- The reference tracer -----------------------------------------------------------------------

class RecordingSpan implements Span {
  readonly context: SpanContext;
  private readonly attributes: Record<string, string | number | boolean> = {};
  private status: SpanStatus = 'unset';
  private error: string | undefined;
  private finished = false;

  constructor(
    readonly name: string,
    context: SpanContext,
    private readonly startedAt: number,
    private readonly clock: () => number,
    private readonly exporter: SpanExporter,
  ) {
    this.context = context;
  }

  get ended(): boolean {
    return this.finished;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (this.finished) return;
    this.attributes[key] = value;
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.finished) return;
    for (const [key, value] of Object.entries(attributes)) this.attributes[key] = value;
  }

  recordError(error: unknown): void {
    if (this.finished) return;
    this.error = String(sanitizeValue(errorMessage(error)));
    this.status = 'error';
  }

  setStatus(status: SpanStatus): void {
    if (this.finished) return;
    this.status = status;
  }

  end(): void {
    if (this.finished) return; // idempotent: a stage that fails then unwinds must not double-export
    this.finished = true;
    const finished: FinishedSpan = {
      context: this.context,
      name: this.name,
      startedAt: this.startedAt,
      durationMs: Math.max(0, this.clock() - this.startedAt),
      status: this.status === 'unset' ? 'ok' : this.status,
      attributes: this.attributes,
      ...(this.error === undefined ? {} : { error: this.error }),
    };
    try {
      this.exporter.export(finished);
    } catch {
      /* an exporter failure must never break the traced operation */
    }
  }
}

export interface DefaultTracerOptions {
  readonly exporter: SpanExporter;
  /** Injectable epoch-ms clock (deterministic tests). */
  readonly clock?: () => number;
  /** Injectable id factory (deterministic tests); default is a random hex generator. */
  readonly ids?: () => string;
  /**
   * Head sampling ratio in `[0, 1]`. A root span is sampled once and its whole subtree follows that
   * decision, so a trace is never half-recorded. Children of a sampled parent are always recorded.
   */
  readonly sampleRatio?: number;
  /** Injectable sampler source (deterministic tests). */
  readonly random?: () => number;
}

/**
 * The reference `Tracer`: builds a parent/child span tree, times each span, and pushes finished
 * spans to an exporter. Sampling is decided ONCE per trace root, so a sampled-out trace costs a
 * single random draw and then returns the shared no-op span for every child.
 */
export class DefaultTracer implements Tracer {
  readonly enabled = true;
  private readonly exporter: SpanExporter;
  private readonly clock: () => number;
  private readonly ids: () => string;
  private readonly sampleRatio: number;
  private readonly random: () => number;

  constructor(options: DefaultTracerOptions) {
    this.exporter = options.exporter;
    this.clock = options.clock ?? ((): number => Date.now());
    this.ids = options.ids ?? randomHex;
    this.sampleRatio = clamp01(options.sampleRatio ?? 1);
    this.random = options.random ?? Math.random;
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const parent = toContext(options.parent);

    if (parent === undefined) {
      // Root span: make the sampling decision for the whole trace here.
      if (this.sampleRatio < 1 && this.random() >= this.sampleRatio) return NOOP_SPAN;
    } else if (parent.traceId === '') {
      // Parent was sampled out — the child follows, keeping traces whole.
      return NOOP_SPAN;
    }

    const context: SpanContext = {
      traceId: parent?.traceId ?? this.ids(),
      spanId: this.ids(),
      ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
    };
    const span = new RecordingSpan(name, context, this.clock(), this.clock, this.exporter);
    if (options.attributes !== undefined) span.setAttributes(options.attributes);
    return span;
  }
}

/** The trace/span ids of a span, as observability fields (for log correlation). */
export function spanFields(span: Span | undefined): ObservabilityFields {
  if (span === undefined || span.context.traceId === '') return {};
  return { traceId: span.context.traceId, spanId: span.context.spanId };
}

function toContext(parent: Span | SpanContext | undefined): SpanContext | undefined {
  if (parent === undefined) return undefined;
  return 'context' in parent ? parent.context : parent;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

let counter = 0;
/** 16 hex chars of process-local uniqueness — enough to correlate, cheap to produce. */
function randomHex(): string {
  counter = (counter + 1) % 0xffffffff;
  const random = Math.floor(Math.random() * 0xffffffff);
  return `${random.toString(16).padStart(8, '0')}${counter.toString(16).padStart(8, '0')}`;
}
