import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin, NotAdminError } from '@/lib/auth/require-admin';
import { presignGet } from '@/lib/r2';

/**
 * GET /api/admin/albums/:id/pdf — admin preview-PDF download link.
 *
 * Unlike the customer route (RLS-scoped to the owner), this is admin-only: requireAdmin()
 * gates it, then the album_pdfs row is read with the service role (admin sees any
 * album's PDF). Returns a short-lived signed URL when a generated file exists.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
  } catch (e) {
    const status = e instanceof NotAdminError && e.message === 'Not signed in' ? 401 : 403;
    return NextResponse.json({ error: 'Forbidden' }, { status });
  }

  const idCheck = z.string().uuid().safeParse(params.id);
  if (!idCheck.success) return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });

  const svc = createServiceClient();
  const { data } = await svc
    .from('album_pdfs')
    .select('status, r2_key, generated_at')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = (data ?? null) as { status: string; r2_key: string | null; generated_at: string | null } | null;
  if (!row) return NextResponse.json({ status: 'idle', url: null });

  const url =
    row.status === 'ready' && row.r2_key
      ? await presignGet(row.r2_key, 120, { downloadFilename: 'album-preview.pdf' })
      : null;

  return NextResponse.json({ status: row.status, generatedAt: row.generated_at, url });
}
