import 'server-only';
import { captureException, captureMessage, type CaptureContext } from './capture';
import { getRequestId } from './request-id';
import { sanitizeMessage, sanitizeMetadata } from './sanitize';
import { fingerprint, type Category, type Severity } from './model';

/**
 * THE structured logging layer (Phase 10B). One entrypoint for app-side server logs so output is
 * consistent (single-line, sanitized, correlated) and so error/critical logs ALSO persist to
 * error_events. Additive: existing console.* calls remain; new code should prefer these.
 */

export type LogOpts = {
  category?: Category;
  metadata?: Record<string, unknown> | null;
  error?: unknown; // attach an Error for stack capture
  requestId?: string | null;
  actor?: string | null; // 'system' | 'admin:<id>' | 'customer:<id>' | ...
  userId?: string | null;
  persist?: boolean; // force-persist a warning (errors/criticals always persist)
};

function emit(level: Severity, source: string, message: string, opts: LogOpts): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    request_id: opts.requestId ?? safeRequestId(),
    actor: opts.actor ?? 'system',
    source,
    category: opts.category ?? 'system',
    // sanitized + single-line so logs can't be poisoned / leak secrets
    message: sanitizeMessage(message),
    ...(opts.metadata ? { metadata: sanitizeMetadata(opts.metadata) } : {}),
  };
  const fn = level === 'info' ? console.log : level === 'warning' ? console.warn : console.error;
  fn(`[obs] ${JSON.stringify(line)}`);
}

export function logInfo(source: string, message: string, opts: LogOpts = {}): void {
  emit('info', source, message, opts);
}

export function logWarning(source: string, message: string, opts: LogOpts = {}): void {
  emit('warning', source, message, opts);
  if (opts.persist) void persist('warning', source, message, opts);
}

export function logError(source: string, message: string, opts: LogOpts = {}): void {
  emit('error', source, message, opts);
  void persist('error', source, message, opts);
}

export function logCritical(source: string, message: string, opts: LogOpts = {}): void {
  emit('critical', source, message, opts);
  void persist('critical', source, message, opts);
}

function persist(severity: Severity, source: string, message: string, opts: LogOpts): Promise<unknown> {
  const ctx: CaptureContext = {
    source,
    category: opts.category ?? 'system',
    severity,
    requestId: opts.requestId,
    userId: opts.userId ?? null,
    metadata: opts.metadata ?? null,
    message,
  };
  return opts.error ? captureException(opts.error, ctx) : captureMessage(message, ctx);
}

/**
 * Performance observability (Phase 7): record a timing ONLY if it crossed its threshold — the
 * fast path does nothing. A slow op becomes a deduped warning error_event (fingerprint
 * slow:<source>:<label>) so it shows in the Error Center without ever blocking the request.
 */
export function recordTiming(
  source: string,
  label: string,
  ms: number,
  thresholdMs: number,
  ctx?: { category?: Category; requestId?: string | null; metadata?: Record<string, unknown> },
): void {
  if (ms < thresholdMs) return;
  // Fingerprint normalization collapses the ms numbers, so all crossings dedupe to one row.
  const message = `Slow ${source}: ${label} took ${Math.round(ms)}ms (>${thresholdMs}ms)`;
  void captureMessage(message, {
    source,
    category: ctx?.category ?? 'system',
    severity: 'warning',
    requestId: ctx?.requestId,
    metadata: { label, ms: Math.round(ms), thresholdMs, ...(ctx?.metadata ?? {}) },
  });
}

// Re-export so callers can build their own fingerprints/types from one import if needed.
export { fingerprint };

function safeRequestId(): string | null {
  try {
    return getRequestId();
  } catch {
    return null;
  }
}
