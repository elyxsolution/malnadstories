import type { RuntimeLogRecord, StructuredLogger } from '@workerv2/worker-runtime';
import type { LogLevel, LogRecord } from './model.js';
import type { WorkerLogger } from './logging.js';

/**
 * LOG SINKS — where finished records go. The logger never knows the destination, so a deployment
 * swaps Console → JSON → a future cloud shipper by composing sinks at the composition root, with no
 * change to any processing code. Sinks are the ONLY place a logging backend is named.
 *
 * Every sink here is synchronous and non-blocking in practice: `process.stdout.write` on a pipe is
 * buffered by Node, and the in-memory sink is a bounded ring. Nothing performs network I/O — a
 * remote shipper would buffer + flush on its own schedule behind this same interface.
 */

/** The pluggable destination for finished log records. Implementations should not throw. */
export interface LogSink {
  write(record: LogRecord): void;
  /** Flush any buffered records (best-effort; the default is a no-op). */
  flush?(): Promise<void>;
}

/** Writes one JSON object per line — the machine-readable production format. */
export class JsonLogSink implements LogSink {
  constructor(
    private readonly out: (line: string) => void = (line): void =>
      void process.stdout.write(`${line}\n`),
  ) {}

  write(record: LogRecord): void {
    this.out(JSON.stringify(record));
  }
}

/**
 * Writes a compact, human-readable line — for local development, where a wall of JSON is hostile.
 * Format: `12:04:31.882 INFO  worker.job.start processor=image-hardening jobId=42`.
 */
export class ConsoleLogSink implements LogSink {
  constructor(
    private readonly out: (line: string) => void = (line): void =>
      void process.stdout.write(`${line}\n`),
  ) {}

  write(record: LogRecord): void {
    const { timestamp, level, message, detail, ...fields } = record;
    const time = timestamp.slice(11, 23);
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) parts.push(`${key}=${String(value)}`);
    }
    if (detail !== undefined) parts.push(JSON.stringify(detail));
    const suffix = parts.length === 0 ? '' : ` ${parts.join(' ')}`;
    this.out(`${time} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
  }
}

/**
 * A bounded in-memory ring of the most recent records. Two uses: test assertions, and the
 * `/diagnostics` endpoint's "recent log tail" — an operator can see what just happened without
 * shelling into the container. Bounded by construction, so it can never grow into a leak.
 */
export class MemoryLogSink implements LogSink {
  private readonly buffer: LogRecord[] = [];

  constructor(private readonly capacity = 200) {}

  write(record: LogRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  /** The retained records, oldest → newest. */
  get records(): readonly LogRecord[] {
    return this.buffer;
  }

  /** Records whose `message` equals `message` (test convenience). */
  withMessage(message: string): readonly LogRecord[] {
    return this.buffer.filter((r) => r.message === message);
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

/** Fans one record out to several sinks; one failing sink never starves the others. */
export class MultiLogSink implements LogSink {
  constructor(private readonly sinks: readonly LogSink[]) {}

  write(record: LogRecord): void {
    for (const sink of this.sinks) {
      try {
        sink.write(record);
      } catch {
        /* isolate sink failures from each other */
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.flush?.() ?? Promise.resolve()));
  }
}

/** Discards everything. */
export class NoopLogSink implements LogSink {
  write(): void {}
}

/**
 * GRACEFUL DEGRADATION for logging: wraps a sink so a failing backend can never break the worker.
 * A throwing sink is retried until `maxFailures` consecutive failures, after which the wrapper
 * permanently falls back to `fallback` (stderr by default) and records that it did so ONCE. The
 * worker keeps running and keeps producing logs — just to a simpler destination.
 */
export function resilientSink(
  primary: LogSink,
  fallback: LogSink = new JsonLogSink((line) => void process.stderr.write(`${line}\n`)),
  maxFailures = 3,
): LogSink {
  let failures = 0;
  let degraded = false;
  return {
    write(record: LogRecord): void {
      if (degraded) {
        try {
          fallback.write(record);
        } catch {
          /* nothing left to try */
        }
        return;
      }
      try {
        primary.write(record);
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= maxFailures) {
          degraded = true;
          try {
            fallback.write({
              timestamp: new Date().toISOString(),
              level: 'error',
              message: 'observability.log_sink.degraded',
              detail: { failures, fallback: 'stderr' },
            });
          } catch {
            /* nothing left to try */
          }
        }
        try {
          fallback.write(record);
        } catch {
          /* nothing left to try */
        }
      }
    },
    flush: (): Promise<void> => primary.flush?.() ?? Promise.resolve(),
  };
}

// --- Bridge to the Worker Runtime's logger ------------------------------------------------------

/**
 * Adapts a `WorkerLogger` to the Worker Runtime's `StructuredLogger` port.
 *
 * This is the single line of glue that lets EVERY existing component (the runtime itself, the
 * infrastructure adapters, the pipeline stages, the recovery scheduler) keep its unchanged
 * `StructuredLogger` dependency while its output now flows through the observability layer —
 * bound fields, level thresholds, sinks and all. It is why this phase adds observability without
 * rewriting the signature of every subsystem built in Phases I-0…I-3.
 *
 * The runtime's four-level vocabulary maps onto the six-level one; `warning` → `warn`. The runtime's
 * first-class record fields (runId/nodeId/processor/outcome/artifacts) are folded into the detail
 * bag so no information is lost in translation.
 */
export function asStructuredLogger(logger: WorkerLogger): StructuredLogger {
  return {
    log(record: RuntimeLogRecord): void {
      const { level, message, detail, ...rest } = record;
      const merged: Record<string, unknown> = { ...detail };
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) merged[key] = value;
      }
      logger.log(
        RUNTIME_LEVELS[level],
        message,
        Object.keys(merged).length === 0 ? undefined : merged,
      );
    },
  };
}

const RUNTIME_LEVELS: Readonly<Record<RuntimeLogRecord['level'], LogLevel>> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
};
