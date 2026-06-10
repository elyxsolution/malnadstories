import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkWorker } from '@/lib/worker/health';
import { rateLimit, sweepRateLimits } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/worker/health
 *
 * The browser's readiness gate (and the lightweight pre-warm) poll THIS route — never
 * the worker directly, so the worker URL stays server-only. Each call is a single
 * short probe; the client owns the 5s cadence, the 90s budget, and the live timer.
 *
 * Hardened against abuse:
 *  - auth-gated (must be a signed-in user) so it isn't an open wake/DoS vector,
 *  - per-user rate limit sized for the worst-case poll (~12/min) + pre-warm,
 *  - the probe itself has a hard timeout (no hanging requests).
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  sweepRateLimits();
  const { ok, retryAfterSec } = rateLimit(`worker-health:${user.id}`, 60, 60_000);
  if (!ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  // `reason` lets the client distinguish "asleep → keep waking" from "misconfigured →
  // stop and show an error immediately" (no pointless 90s wait on a broken deploy).
  const result = await checkWorker();
  return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
}
