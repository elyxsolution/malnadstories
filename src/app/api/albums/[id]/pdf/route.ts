import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';

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
    .select('status, r2_key, generated_at')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = (data ?? null) as { status: string; r2_key: string | null; generated_at: string | null } | null;
  if (!row) {
    return NextResponse.json({ status: 'idle' });
  }

  // A short-lived download URL only when a generated file exists.
  const url =
    row.status === 'ready' && row.r2_key
      ? await presignGet(row.r2_key, 120, { downloadFilename: 'album-preview.pdf' })
      : null;

  return NextResponse.json({ status: row.status, generatedAt: row.generated_at, url });
}
