import type { Logger, LogFields } from './types.js';

/** A `Logger` that discards everything. Useful as a default and in tests. */
export class NoopLogger implements Logger {
  debug(_message: string, _fields?: LogFields): void {}
  info(_message: string, _fields?: LogFields): void {}
  warn(_message: string, _fields?: LogFields): void {}
  error(_message: string, _fields?: LogFields): void {}
  child(_fields: LogFields): Logger {
    return this;
  }
}
