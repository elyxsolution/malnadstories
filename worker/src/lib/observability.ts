import { randomUUID } from 'node:crypto';
import { supabase } from '../supabase.js';

/**
 * Worker-side observability (Phase 10B). Self-contained mirror of the app's capture layer — the
 * worker is a separate package and can't import `@/lib`. It writes through the SAME service-role
 * record_error_event RPC (dedupe + audit + critical-alert all happen in the DB), with the SAME
 * sanitization contract (no secrets/PII ever persisted). Best-effort: NEVER throws.
 */

type Severity = 'info' | 'warning' | 'error' | 'critical';
type Category = 'api' | 'payment' | 'upload' | 'pdf' | 'email' | 'auth' | 'support' | 'shipping' | 'system';

const REDACTED = '[redacted]';
const DENY_KEY = /pass|secret|token|key|authorization|auth|cookie|signature|hmac|jwt|otp|cvv|card|credential|bearer|session/i;

function scrubText(input: string): string {
  return input
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED)
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED)
    .replace(/\b(?:\d[ -]?){13,16}\b/g, '[card]')
    .replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '[email]@$1')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[phone]');
}

function sanitizeMessage(s: string): string {
  return scrubText(String(s ?? '')).replace(/\s+/g, ' ').slice(0, 2_000);
}

function sanitizeStack(s: string | null | undefined): string | null {
  if (!s) return null;
  return scrubText(String(s)).split('\n').slice(0, 30).join('\n').slice(0, 8_000) || null;
}

function sanitizeMetadata(input: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!input) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n++ >= 50) break;
    if (DENY_KEY.test(k)) {
      out[k] = REDACTED;
    } else if (typeof v === 'string') {
      out[k] = scrubText(v).slice(0, 1_000);
    } else if (typeof v === 'number' || typeof v === 'boolean' || v == null) {
      out[k] = v;
    } else {
      try {
        out[k] = scrubText(JSON.stringify(v)).slice(0, 1_000);
      } catch {
        out[k] = '[unserializable]';
      }
    }
  }
  return out;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function fingerprint(category: string, source: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/[0-9a-f]{16,}/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `${category}|${source}|${djb2(normalized)}`;
}

export type WorkerCaptureContext = {
  source: string;
  category: Category;
  severity?: Severity;
  requestId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  message?: string;
};

async function record(
  severity: Severity,
  rawMessage: string,
  rawStack: string | null,
  ctx: WorkerCaptureContext,
): Promise<void> {
  try {
    const message = sanitizeMessage(ctx.message ?? rawMessage);
    const { error } = await supabase.rpc('record_error_event', {
      p_severity: severity,
      p_source: ctx.source,
      p_category: ctx.category,
      p_message: message,
      p_stack: sanitizeStack(rawStack),
      p_request_id: ctx.requestId ?? null,
      p_user_id: ctx.userId ?? null,
      p_metadata: sanitizeMetadata(ctx.metadata),
      p_fingerprint: fingerprint(ctx.category, ctx.source, message),
    });
    if (error) console.error('[worker][obs] record_error_event failed — continuing:', error.message);
  } catch (e) {
    console.error('[worker][obs] capture failed — continuing:', String(e));
  }
}

export async function captureException(error: unknown, ctx: WorkerCaptureContext): Promise<void> {
  const message = ctx.message ?? (error instanceof Error ? error.message || error.name : String(error));
  const stack = error instanceof Error ? error.stack ?? null : null;
  await record(ctx.severity ?? 'error', message, stack, ctx);
}

export async function captureMessage(message: string, ctx: WorkerCaptureContext): Promise<void> {
  await record(ctx.severity ?? 'warning', message, null, ctx);
}

/** Record a slow job ONLY when it crosses the threshold (deduped, never blocks). */
export async function recordTiming(
  source: string,
  label: string,
  ms: number,
  thresholdMs: number,
  ctx?: { requestId?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  if (ms < thresholdMs) return;
  const message = `Slow ${source}: ${label} took ${Math.round(ms)}ms (>${thresholdMs}ms)`;
  await captureMessage(message, {
    source,
    category: 'system',
    severity: 'warning',
    requestId: ctx?.requestId,
    metadata: { label, ms: Math.round(ms), thresholdMs, ...(ctx?.metadata ?? {}) },
  });
}

export const PERF = { slowPdfMs: 45_000, slowUploadMs: 30_000 } as const;

/** A per-job correlation id (no inbound request scope in the worker). */
export const jobRequestId = (queue: string): string => `job:${queue}:${randomUUID().slice(0, 8)}`;
