'use server';

import { randomBytes, createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { enqueueAlbumPdf } from '@/lib/queue';

export type ActionResult = { ok: true } | { ok: false; error: string };

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Request a preview-PDF generation for an album.
 *
 * Ownership is verified via the AUTHENTICATED client (RLS → null for a non-owner),
 * then a short-lived single-use print token is minted: only its sha256 hash is
 * stored (service role), the raw token rides in the job payload to the worker. We
 * keep any previously-generated PDF downloadable until the new one is ready.
 */
export async function requestAlbumPdf(albumId: unknown): Promise<ActionResult> {
  if (typeof albumId !== 'string') return { ok: false, error: 'Invalid album' };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  // Ownership gate (RLS): a foreign/nonexistent album returns null.
  const { data: album } = await supabase.from('albums').select('id').eq('id', albumId).maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Service role: album_pdfs is service-only. Upsert keeps r2_key/generated_at from a
  // prior run (still downloadable) while we flip status to 'generating'.
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const admin = createServiceClient();
  const { error } = await admin.from('album_pdfs').upsert(
    {
      album_id: albumId,
      status: 'generating',
      error: null,
      token_hash: tokenHash,
      token_expires_at: tokenExpiresAt,
      token_used_at: null,
    },
    { onConflict: 'album_id' },
  );
  if (error) {
    console.error('requestAlbumPdf upsert error:', error);
    return { ok: false, error: 'Could not start PDF generation.' };
  }

  try {
    const jobId = await enqueueAlbumPdf(albumId, token);
    // Diagnostics: which job carries this token, and the token's expiry. (Raw token
    // is never logged; tokenHash prefix is enough to correlate with the worker log.)
    console.log('[pdf] enqueued album-pdf', {
      albumId,
      jobId,
      tokenHash: tokenHash.slice(0, 8),
      tokenExpiresAt,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('enqueue album-pdf failed:', e);
    await admin
      .from('album_pdfs')
      .update({ status: 'failed', error: 'Could not enqueue job' })
      .eq('album_id', albumId);
    return { ok: false, error: 'Could not start PDF generation.' };
  }

  return { ok: true };
}
