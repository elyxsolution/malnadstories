import type { LogLevel, LogRecord, ObservabilityFields, SanitizeLimits } from './model.js';
import { DEFAULT_LIMITS, LEVEL_ORDER, compactFields, sanitizeDetail } from './model.js';
import type { LogSink } from './sinks.js';

/**
 * STRUCTURED LOGGING — the worker's logging contract and its reference implementation.
 *
 * Two properties make this different from the ad-hoc logging it replaces:
 *
 *   1. FIELDS ARE BOUND, NOT REPEATED. `child()` returns a logger carrying additional context
 *      (workerId → processor → job → stage), so a stage's log line automatically carries the whole
 *      chain without any call site passing it. This is what lets processing code stop threading
 *      correlation ids by hand.
 *   2. SINKS ARE PLUGGABLE. The logger never knows where lines go; it hands finished records to a
 *      `LogSink`. Console, JSON lines, an in-memory ring, or a future cloud shipper are all sinks.
 *      No backend is hardcoded anywhere in this layer.
 *
 * PERFORMANCE: the level check happens FIRST, before any record object, field merge, or detail
 * sanitization is allocated — a `trace()` call under an `info` threshold costs one integer compare.
 * Serialization happens in the sink, and only for records that survive the threshold.
 */

/** The logging port every subsystem depends on. Implementations must never throw. */
export interface WorkerLogger {
  trace(message: string, detail?: Readonly<Record<string, unknown>>): void;
  debug(message: string, detail?: Readonly<Record<string, unknown>>): void;
  info(message: string, detail?: Readonly<Record<string, unknown>>): void;
  warn(message: string, detail?: Readonly<Record<string, unknown>>): void;
  error(message: string, detail?: Readonly<Record<string, unknown>>): void;
  fatal(message: string, detail?: Readonly<Record<string, unknown>>): void;
  /** Emit at a dynamic level (used by bridges that map another vocabulary onto this one). */
  log(level: LogLevel, message: string, detail?: Readonly<Record<string, unknown>>): void;
  /**
   * Emit with PER-CALL context fields promoted to the top level of the record, without allocating a
   * child logger. This is the hot path used by the event sink, where `processor`/`stage`/`durationMs`
   * differ on every event: `child()` per event would allocate a logger and a merged field object
   * each time, whereas `record` merges once, inside the level check.
   */
  record(
    level: LogLevel,
    message: string,
    fields?: ObservabilityFields,
    detail?: Readonly<Record<string, unknown>>,
  ): void;
  /** A logger carrying `fields` in addition to this one's. Cheap — shares the sink. */
  child(fields: ObservabilityFields): WorkerLogger;
  /** Whether a level would be emitted (lets a caller skip building an expensive detail bag). */
  isEnabled(level: LogLevel): boolean;
  /** The bound fields, for diagnostics + span correlation. */
  readonly fields: ObservabilityFields;
}

export interface ObservabilityLoggerOptions {
  /** Minimum level emitted (default `info`). */
  readonly level?: LogLevel;
  /** Where finished records go. */
  readonly sink: LogSink;
  /** Fields bound to every record from this logger. */
  readonly fields?: ObservabilityFields;
  /** Injectable clock (deterministic tests). */
  readonly now?: () => Date;
  /** Sanitization bounds applied to every detail bag. */
  readonly limits?: SanitizeLimits;
}

/** The reference `WorkerLogger`: threshold filtering + bound fields + sink fan-out. */
export class ObservabilityLogger implements WorkerLogger {
  private readonly threshold: number;
  private readonly sink: LogSink;
  private readonly now: () => Date;
  private readonly limits: SanitizeLimits;
  readonly fields: ObservabilityFields;

  constructor(options: ObservabilityLoggerOptions) {
    this.threshold = LEVEL_ORDER[options.level ?? 'info'];
    this.sink = options.sink;
    this.fields = compactFields(options.fields ?? {});
    this.now = options.now ?? ((): Date => new Date());
    this.limits = options.limits ?? DEFAULT_LIMITS;
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.threshold;
  }

  log(level: LogLevel, message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.record(level, message, undefined, detail);
  }

  record(
    level: LogLevel,
    message: string,
    fields?: ObservabilityFields,
    detail?: Readonly<Record<string, unknown>>,
  ): void {
    // Hot path: bail before allocating anything at all.
    if (LEVEL_ORDER[level] < this.threshold) return;
    // `sanitizeDetail` collapses an empty bag to `undefined`; omit the key entirely rather than
    // emitting `detail: undefined`, so records stay lean and JSON output has no dangling keys.
    const sanitized = sanitizeDetail(detail, this.limits);
    const record: LogRecord = {
      timestamp: this.now().toISOString(),
      level,
      message,
      ...this.fields,
      ...(fields === undefined ? {} : compactFields(fields)),
      ...(sanitized === undefined ? {} : { detail: sanitized }),
    };
    // A logging failure must never propagate into processing. Sinks are expected to be resilient
    // (see `resilientSink`), but this is the belt-and-braces guarantee at the emit boundary.
    try {
      this.sink.write(record);
    } catch {
      /* observability is best-effort — never break the caller */
    }
  }

  trace(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('trace', message, detail);
  }
  debug(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('debug', message, detail);
  }
  info(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('info', message, detail);
  }
  warn(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('warn', message, detail);
  }
  error(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('error', message, detail);
  }
  fatal(message: string, detail?: Readonly<Record<string, unknown>>): void {
    this.log('fatal', message, detail);
  }

  child(fields: ObservabilityFields): WorkerLogger {
    return new ObservabilityLogger({
      level: levelOf(this.threshold),
      sink: this.sink,
      fields: { ...this.fields, ...compactFields(fields) },
      now: this.now,
      limits: this.limits,
    });
  }
}

/** A logger that discards everything (opt-out / tests). */
export class NoopLogger implements WorkerLogger {
  readonly fields: ObservabilityFields = {};
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
  log(): void {}
  record(): void {}
  isEnabled(): boolean {
    return false;
  }
  child(): WorkerLogger {
    return this;
  }
}

function levelOf(threshold: number): LogLevel {
  const found = (Object.keys(LEVEL_ORDER) as LogLevel[]).find(
    (level) => LEVEL_ORDER[level] === threshold,
  );
  return found ?? 'info';
}
