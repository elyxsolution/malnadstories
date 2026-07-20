import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { probeWorker } from '@/lib/worker/health';

/**
 * GET /api/albums/:id/pdf
 *
 * Returns the album's preview-PDF status and, when ready, a short-lived signed
 * download URL. Ownership is verified via the AUTHENTICATED client (RLS); the
 * album_pdfs row itself is read with the service role (it's service-only). The
 * builder polls this while status is 'generating'.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const idCheck = z.string().uuid().safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Ownership gate (RLS): non-owner / missing album → null.
  const { data: album } = await supabase.from('albums').select('id').eq('id', params.id).maybeSingle();
  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

  const admin = createServiceClient();
  const { data } = await admin
    .from('album_pdfs')
    .select('status, r2_key, generated_at, stage, failure_code')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = (data ?? null) as {
    status: string;
    r2_key: string | null;
    generated_at: string | null;
    stage: string | null;
    failure_code: string | null;
  } | null;

  // While a PDF isn't ready, the customer is actively waiting — use the poll to NUDGE
  // the sleepable worker awake (best-effort). Waking it lets its sweep drain the queued
  // job or heal a paid-album-without-PDF, so generation can't stall on a dormant worker.
  if (!row || row.status !== 'ready') {
    probeWorker(2500).catch(() => {});
  }

  if (!row) {
    return NextResponse.json({ status: 'idle' });
  }

  // Download URL is gated on the FILE existing (r2_key), NOT on status === 'ready' (audit H-2).
  // A regeneration (admin regenerate, recovery redrive) flips status → 'generating' while the
  // previously-generated r2_key stays valid; the generator/recovery never clear r2_key on a redrive.
  // Gating on the key means an already-generated preview stays downloadable throughout a regen
  // instead of vanishing. `downloadReady` tells the client a file is available regardless of status.
  const url = row.r2_key
    ? await presignGet(row.r2_key, 120, { downloadFilename: 'album-preview.pdf' })
    : null;

  return NextResponse.json({
    status: row.status,
    stage: row.stage,
    failureCode: row.failure_code, // the UI maps this to a customer-safe note (never the raw cause)
    generatedAt: row.generated_at,
    url,
    downloadReady: !!url,
  });
}
