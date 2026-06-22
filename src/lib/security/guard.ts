import 'server-only';

import { headers } from 'next/headers';
import { rateLimit, sweepRateLimits } from '@/lib/rate-limit';
import { logSecurity, type SecurityActor } from '@/lib/security/audit';

/**
 * Centralised abuse-protection helpers (Phase 10C).
 *
 * ONE code path on top of the existing in-memory `rateLimit` (lib/rate-limit) so every
 * throttled surface limits + audits identically — no duplicated logic. `checkLimit`
 * emits a `security.rate_limit` audit row on a block (best-effort) and returns a
 * uniform result. Same per-process caveat as rate-limit.ts / pg-boss: fine for a single
 * instance; move to a shared store before any multi-instance deploy.
 */

/** Best-effort client IP from proxy headers (server actions + route handlers). */
export function clientIp(): string {
  const h = headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export async function checkLimit(
  key: string,
  limit: number,
  windowMs: number,
  ctx: { surface: string; actor?: SecurityActor; metadata?: Record<string, unknown> },
): Promise<LimitResult> {
  sweepRateLimits();
  const rl = rateLimit(key, limit, windowMs);
  if (rl.ok) return { ok: true };

  await logSecurity(
    'security.rate_limit',
    { surface: ctx.surface, limit, windowMs, retryAfterSec: rl.retryAfterSec, ...(ctx.metadata ?? {}) },
    ctx.actor,
  );
  return { ok: false, retryAfterSec: rl.retryAfterSec };
}

/**
 * Hygiene for user-supplied filenames stored as text (upload confirm, G2). Strips
 * control characters (code-point filter — avoids embedding raw control bytes here),
 * collapses whitespace, and caps length. React escapes on render so XSS risk is low;
 * this is about log safety + clean storage. Empty result falls back to 'file'.
 */
export function sanitizeFilename(value: string, max = 255): string {
  let stripped = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue; // drop control chars
    stripped += ch;
  }
  const cleaned = stripped.replace(/\s+/g, ' ').trim().slice(0, max);
  return cleaned || 'file';
}
