'use server';

import { randomBytes, createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { enqueueAlbumPdf } from '@/lib/queue';
import { checkWorker } from '@/lib/worker/health';
import {
  LAYOUT_TEMPLATES,
  validateAlbumForPdf,
  type Block,
  type LayoutTemplate,
  type Overlay,
} from '@/lib/builder/model';

export type ActionResult = { ok: true } | { ok: false; error: string };

type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: { overlays?: Overlay[] } | null;
};

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
  const { data: album } = await supabase
    .from('albums')
    .select('id, size, cover_template_id')
    .eq('id', albumId)
    .maybeSingle();
  if (!album) return { ok: false, error: 'Album not found' };
  const { size, cover_template_id } = album as { size: number; cover_template_id: string | null };

  // ── Server-side PDF validation (REQUIREMENT 7) ──────────────────────────────
  // Re-read the saved layout from the DB (never trust the client) and run the SAME
  // pure validator the builder uses. A failure means a stale/forged request — refuse
  // to mint a token or enqueue, so we never generate a misaligned/incomplete book.
  let hasActiveCover = false;
  if (cover_template_id) {
    // Resolve the cover regardless of active (a soft-deleted cover an album already
    // uses still renders) via the service role. We require only that it EXISTS with
    // artwork — resolution is informational (admin badge), never a generation blocker.
    const svc = createServiceClient();
    const { data: cover } = await svc
      .from('cover_templates')
      .select('id, image_key')
      .eq('id', cover_template_id)
      .maybeSingle();
    const c = cover as { id: string; image_key: string | null } | null;
    hasActiveCover = !!(c && c.image_key);
  }

  const { data: pageData } = await supabase
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', albumId)
    .order('page_number', { ascending: true });

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  const blocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: `${r.page_number}`,
      template: r.layout_template as LayoutTemplate,
      photoIds: (r.photo_ids ?? []).filter(Boolean),
      caption: r.caption ?? '',
      overlays: r.layout_config?.overlays ?? [],
    }));

  const check = validateAlbumForPdf(blocks, size, hasActiveCover);
  if (!check.ok) {
    return { ok: false, error: check.errors[0] };
  }

  // Defense-in-depth worker gate (fail-closed): the client wakes the worker before
  // calling this, but confirm it's reachable server-side too. The print token lives
  // only 5 minutes — if we enqueued with no worker running it would expire and the job
  // would 404. A single quick probe (no long block) keeps this action fast; the
  // client's wake-up modal is the loop that actually waits.
  const worker = await checkWorker();
  if (!worker.ready) {
    return {
      ok: false,
      error:
        worker.reason === 'misconfigured'
          ? 'PDF generation is temporarily unavailable. Please try again later.'
          : 'The image service is starting up. Please try again in a moment.',
    };
  }

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
