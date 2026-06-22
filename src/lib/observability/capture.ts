import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { getRequestId } from './request-id';
import { sanitizeMessage, sanitizeStack, sanitizeMetadata } from './sanitize';
import { fingerprint, type Category, type Severity } from './model';

/**
 * Exception capture (Phase 10B). Persists ONE sanitized error_events row via the service-role
 * record_error_event RPC (which dedupes by fingerprint, audits, and opens a critical alert).
 *
 * House rule: capture is ALWAYS best-effort and NEVER throws — a capture failure can never
 * affect the operation being observed. It is additive alongside existing console.* logging.
 */

export type CaptureContext = {
  source: string; // 'razorpay-webhook' | 'album-pdf' | 'email' | 'client' | ...
  category: Category;
  severity?: Severity; // default 'error'
  requestId?: string | null; // defaults to the ambient request id
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  message?: string; // override (otherwise derived from the error)
};

/** Capture a thrown error. Best-effort, never throws. Returns the row id or null. */
export async function captureException(error: unknown, ctx: CaptureContext): Promise<string | null> {
  const message = ctx.message ?? errorMessage(error);
  const stack = error instanceof Error ? error.stack ?? null : null;
  return record(ctx.severity ?? 'error', message, stack, ctx);
}

/** Capture a message without an Error object (e.g. a logical/validation failure or slow op). */
export async function captureMessage(
  message: string,
  ctx: CaptureContext,
): Promise<string | null> {
  return record(ctx.severity ?? 'warning', message, null, ctx);
}

async function record(
  severity: Severity,
  rawMessage: string,
  rawStack: string | null,
  ctx: CaptureContext,
): Promise<string | null> {
  try {
    const message = sanitizeMessage(rawMessage);
    const stack = sanitizeStack(rawStack);
    const metadata = sanitizeMetadata(ctx.metadata ?? null);
    const requestId = ctx.requestId === undefined ? safeRequestId() : ctx.requestId;
    const fp = fingerprint(ctx.category, ctx.source, message);

    const svc = createServiceClient();
    const { data, error } = await svc.rpc('record_error_event', {
      p_severity: severity,
      p_source: ctx.source,
      p_category: ctx.category,
      p_message: message,
      p_stack: stack,
      p_request_id: requestId,
      p_user_id: ctx.userId ?? null,
      p_metadata: metadata,
      p_fingerprint: fp,
    });
    if (error) {
      console.error('[observability] record_error_event failed — continuing', error.message);
      return null;
    }
    return (data as string | null) ?? null;
  } catch (e) {
    console.error('[observability] capture failed — continuing', String(e));
    return null;
  }
}

/**
 * Wrap an async operation: on throw, capture then RETHROW (behavior preserved). The reusable
 * adoption helper for new/migrated call sites.
 */
export async function withCapture<T>(
  ctx: CaptureContext,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    await captureException(e, ctx);
    throw e;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function safeRequestId(): string | null {
  try {
    return getRequestId();
  } catch {
    return null;
  }
}
