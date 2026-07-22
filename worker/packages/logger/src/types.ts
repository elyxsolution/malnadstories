import type { JsonObject } from '@workerv2/contracts';

/** Log severities, ordered least→most severe. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric ordering used for threshold filtering. */
export const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Structured, JSON-safe fields attached to a log line. Never include secrets/PII. */
export type LogFields = JsonObject;

/**
 * The logging abstraction every subsystem depends on. Implementations decide where lines go
 * (console, buffer, remote). `child` returns a logger with additional bound fields — the
 * seam correlation ids attach to in later phases.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}
