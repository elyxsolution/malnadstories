/**
 * OBSERVABILITY MODEL — the shared vocabulary of the observability layer: severity levels, the
 * structured field set every signal carries, and the sanitization/bounding rules applied to any
 * operator-visible payload.
 *
 * This module is PURE (no I/O, no globals, no clock) so it can be reasoned about and tested in
 * isolation, and so the logging/tracing/metrics/health subsystems all agree on one field vocabulary
 * instead of inventing their own. Nothing here knows about photos, albums, PDFs, or any backend.
 */

// --- Severity ---------------------------------------------------------------------------------

/** The six operator-facing severities, ordered least → most severe. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Numeric ordering used for threshold filtering (cheap integer compare on the hot path). */
export const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Every level, least → most severe (stable order for config help + diagnostics). */
export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/** Whether `value` is one of the six levels. */
export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse a configured level, falling back when unset/unknown. Never throws — an unreadable logging
 * config must never prevent the worker from logging (it degrades to the fallback instead).
 */
export function parseLogLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  // `warning` is the Worker Runtime's spelling; accept it so one env var serves both vocabularies.
  if (normalized === 'warning') return 'warn';
  return isLogLevel(normalized) ? normalized : fallback;
}

// --- The structured field set ------------------------------------------------------------------

/**
 * The correlation/context fields that travel with every log line, span, and metric tag. They are all
 * optional because a signal is emitted from wherever it happens — a startup log has no `jobId`, a
 * stage log has all of them. Loggers BIND these once (`child`) rather than each call site repeating
 * them, which is what keeps instrumentation out of processing code.
 */
export interface ObservabilityFields {
  /** Identifies this worker process (host/instance) — distinguishes lines when several workers run. */
  readonly workerId?: string;
  /** The processor / job type (e.g. `image-hardening`, `album-pdf`). */
  readonly processor?: string;
  /** The pipeline the work belongs to (today 1:1 with the processor; separate so it can diverge). */
  readonly pipeline?: string;
  /** The pipeline stage (`validating`, `render`, `upload`, …). */
  readonly stage?: string;
  /** The broker job id (ack/nack identity). */
  readonly jobId?: string;
  /** Correlates one unit of work across app → broker → worker (the app's `x-request-id`). */
  readonly correlationId?: string;
  /** The trace this signal belongs to, when tracing is enabled. */
  readonly traceId?: string;
  /** The span this signal was emitted inside, when tracing is enabled. */
  readonly spanId?: string;
  /** Elapsed time of the operation being reported (ms). */
  readonly durationMs?: number;
  /** 1-based broker delivery attempt. */
  readonly attempt?: number;
}

/** One emitted log entry: severity + time + message + bound fields + a bounded detail bag. */
export interface LogRecord extends ObservabilityFields {
  /** ISO-8601 emission time. */
  readonly timestamp: string;
  readonly level: LogLevel;
  /** A stable, low-cardinality event name (`worker.job.start`), never an interpolated sentence. */
  readonly message: string;
  /** Sanitized, size-bounded structured payload. Never secrets, never PII. */
  readonly detail?: Record<string, unknown>;
}

/** Drop the `undefined`-valued keys of a field bag so records stay compact and stable. */
export function compactFields(fields: ObservabilityFields): ObservabilityFields {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out as ObservabilityFields;
}

// --- Sanitization + bounding -------------------------------------------------------------------

/**
 * Field names whose VALUES are never recorded. Matched case-insensitively as a substring of the
 * normalized key, so `token`, `printToken`, `tokenHash`, and `access_token` are all covered.
 *
 * Deliberately NOT listed: `key` on its own. The worker's domain is full of legitimate object keys
 * (`rawKey`, `thumbKey`, `sanitizedKey`, `r2Key`) whose values are exactly what an operator needs
 * to debug a storage problem. Only genuinely secret-bearing names are denied.
 */
const REDACTED_KEYS: readonly string[] = [
  'secret',
  'password',
  'passwd',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'accesskeyid',
  'secretaccesskey',
  'connectionstring',
  'connection_string',
  'credential',
  'cookie',
  'signature',
  'dsn',
];

/** The marker written in place of a denied value (so its PRESENCE is still visible). */
export const REDACTED = '[redacted]';

/** Bounds that keep a single record small, cheap to serialize, and safe to ship. */
export interface SanitizeLimits {
  /** Maximum nesting depth before a value collapses to `[depth]`. */
  readonly maxDepth: number;
  /** Maximum own keys kept per object. */
  readonly maxKeys: number;
  /** Maximum elements kept per array. */
  readonly maxArray: number;
  /** Maximum characters kept per string. */
  readonly maxString: number;
}

export const DEFAULT_LIMITS: SanitizeLimits = {
  maxDepth: 4,
  maxKeys: 32,
  maxArray: 32,
  maxString: 512,
};

function isRedactedKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACTED_KEYS.some((denied) => normalized.includes(denied));
}

/**
 * Sanitize + bound an arbitrary value for recording. This is THE security/performance boundary of
 * the observability layer: it redacts secret-bearing keys, truncates long strings, caps object/array
 * width and nesting, converts Errors to `name: message`, and renders non-JSON values safely. It is
 * total (never throws) and allocation-conscious — it only runs for records that will actually be
 * emitted, after the level check.
 */
export function sanitizeValue(
  value: unknown,
  limits: SanitizeLimits = DEFAULT_LIMITS,
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case 'string':
      return value.length > limits.maxString
        ? `${value.slice(0, limits.maxString)}…(+${value.length - limits.maxString})`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return `[${typeof value}]`;
    default:
      break;
  }

  if (value instanceof Error) {
    return { name: value.name, message: sanitizeValue(value.message, limits, depth + 1) };
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= limits.maxDepth) return '[depth]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, limits.maxArray).map((v) => sanitizeValue(v, limits, depth + 1));
    if (value.length > limits.maxArray) kept.push(`…(+${value.length - limits.maxArray})`);
    return kept;
  }

  if (value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (count >= limits.maxKeys) {
        out['…'] = 'truncated';
        break;
      }
      out[key] = isRedactedKey(key) ? REDACTED : sanitizeValue(inner, limits, depth + 1);
      count += 1;
    }
    return out;
  }

  return String(value);
}

/** Sanitize a detail bag, returning `undefined` for an empty/absent one (keeps records lean). */
export function sanitizeDetail(
  detail: Readonly<Record<string, unknown>> | undefined,
  limits: SanitizeLimits = DEFAULT_LIMITS,
): Record<string, unknown> | undefined {
  if (detail === undefined) return undefined;
  const keys = Object.keys(detail);
  if (keys.length === 0) return undefined;
  return sanitizeValue(detail, limits, 0) as Record<string, unknown>;
}

/** Normalize any thrown value to a short, safe message (the one place this conversion lives). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
