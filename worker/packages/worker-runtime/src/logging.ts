/**
 * STRUCTURED LOGGING — a replaceable, injectable logger emitting structured run/node records
 * (Run ID · Node ID · Processor · Duration · Outcome · Artifact IDs). It is OBSERVATIONAL ONLY: the
 * runtime emits records around execution, but nothing logged ever feeds back into execution. Three
 * references ship: a console logger (one JSON line per record), a recording logger (tests), and a
 * no-op. A real deployment injects its own (e.g. a log shipper) behind the same interface.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

/** A structured runtime log record. */
export interface RuntimeLogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly runId?: string;
  readonly nodeId?: string;
  readonly processor?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
  readonly artifacts?: readonly string[];
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface StructuredLogger {
  log(record: RuntimeLogRecord): void;
}

/** A logger that records every entry — for tests + inspection. */
export class RecordingLogger implements StructuredLogger {
  readonly records: RuntimeLogRecord[] = [];
  log(record: RuntimeLogRecord): void {
    this.records.push(record);
  }
  /** Records for a given run, in order. */
  forRun(runId: string): readonly RuntimeLogRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }
}

/** A logger that discards everything (structured logging disabled). */
export const noopLogger: StructuredLogger = { log: (): void => {} };

/** A logger that emits one JSON line per record to an injected sink (default: nothing). */
export function jsonLineLogger(write: (line: string) => void): StructuredLogger {
  return { log: (record: RuntimeLogRecord): void => write(JSON.stringify(record)) };
}
