import { NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, sweepRateLimits } from '@/lib/rate-limit';
import { captureMessage } from '@/lib/observability/capture';

// Node runtime: the capture layer uses the service-role client + Node crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Client crash sink (Phase 10B). global-error.tsx POSTs sanitized React render-error info here so
 * browser crashes land in error_events too. NOT an admin surface — it is unauthenticated but
 * IP-rate-limited, Zod-capped, and re-sanitized server-side (the capture layer scrubs again). It
 * only ever WRITES via the service role; it returns no data.
 */
const BodySchema = z.object({
  message: z.string().max(2_000).optional(),
  stack: z.string().max(8_000).optional(),
  digest: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  sweepRateLimits();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  // Tight limit — a crashing client can loop; one row per fingerprint dedupes, this caps volume.
  const rl = rateLimit(`obs-report:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const requestId = request.headers.get('x-request-id');
  await captureMessage(body.message || 'Client render error', {
    source: 'client',
    category: 'system',
    severity: 'error',
    requestId,
    metadata: { stack: body.stack, digest: body.digest, path: body.path },
  });

  return NextResponse.json({ ok: true });
}
