import type { Logger, LogLevel, LogFields } from './types.js';
import { LEVEL_ORDER } from './types.js';

/** Sink signature — lets tests capture output instead of hitting the real console. */
export type LogSink = (line: string) => void;

export interface ConsoleLoggerOptions {
  /** Minimum level to emit (default `info`). */
  readonly level?: LogLevel;
  /** Fields bound to every line from this logger. */
  readonly base?: LogFields;
  /** Where to write (default `console.log`). */
  readonly sink?: LogSink;
  /** Injectable clock for deterministic timestamps in tests. */
  readonly now?: () => Date;
}

/**
 * Reference `Logger` that emits one structured JSON line per call. Deliberately minimal —
 * the full observability platform (correlation, sampling, remote sinks) is a later phase.
 */
export class ConsoleLogger implements Logger {
  private readonly threshold: number;
  private readonly base: LogFields;
  private readonly sink: LogSink;
  private readonly now: () => Date;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.threshold = LEVEL_ORDER[options.level ?? 'info'];
    this.base = options.base ?? {};
    this.sink = options.sink ?? ((line) => console.log(line));
    this.now = options.now ?? (() => new Date());
  }

  private emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < this.threshold) return;
    const record = {
      level,
      time: this.now().toISOString(),
      message,
      ...this.base,
      ...fields,
    };
    this.sink(JSON.stringify(record));
  }

  debug(message: string, fields?: LogFields): void {
    this.emit('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.emit('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.emit('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.emit('error', message, fields);
  }

  child(fields: LogFields): Logger {
    return new ConsoleLogger({
      level: levelFromThreshold(this.threshold),
      base: { ...this.base, ...fields },
      sink: this.sink,
      now: this.now,
    });
  }
}

function levelFromThreshold(threshold: number): LogLevel {
  const found = (Object.keys(LEVEL_ORDER) as LogLevel[]).find((l) => LEVEL_ORDER[l] === threshold);
  return found ?? 'info';
}
