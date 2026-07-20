import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { requireCapability, NotAdminError } from '@/lib/auth/require-admin';
import { presignGet } from '@/lib/r2';

/**
 * GET /api/admin/albums/:id/pdf — admin preview-PDF download link.
 *
 * Unlike the customer route (RLS-scoped to the owner), this is admin-only. It lives OUTSIDE
 * the admin layout, so it enforces RBAC itself: requireCapability('album:view') (production /
 * super_admin), then the album_pdfs row is read with the service role. Returns a short-lived
 * signed URL when a generated file exists.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireCapability('album:view');
  } catch (e) {
    const status = e instanceof NotAdminError && e.message === 'Not signed in' ? 401 : 403;
    return NextResponse.json({ error: 'Forbidden' }, { status });
  }

  const idCheck = z.string().uuid().safeParse(params.id);
  if (!idCheck.success) return NextResponse.json({ error: 'Invalid album id' }, { status: 400 });

  const svc = createServiceClient();
  const { data } = await svc
    .from('album_pdfs')
    .select('status, r2_key, generated_at, error, stage, failure_code')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = (data ?? null) as
    | { status: string; r2_key: string | null; generated_at: string | null; error: string | null; stage: string | null; failure_code: string | null }
    | null;
  if (!row) return NextResponse.json({ status: 'idle', url: null });

  // Gate on the FILE existing, not status (audit H-2) — a regen keeps the prior PDF downloadable.
  const url = row.r2_key
    ? await presignGet(row.r2_key, 120, { downloadFilename: 'album-preview.pdf' })
    : null;

  // Surface the worker-stored failure reason to the admin UI (admin-only — never sent to
  // customers). This is what makes an `APP_URL`/print-route/render failure diagnosable
  // instead of a generic dead-end.
  return NextResponse.json({ status: row.status, stage: row.stage, failureCode: row.failure_code, generatedAt: row.generated_at, url, downloadReady: !!url, error: row.error });
}
