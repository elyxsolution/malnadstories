import 'server-only';

import { randomBytes, createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { enqueueAlbumPdf } from '@/lib/queue';
import { checkWorker, probeWorker } from '@/lib/worker/health';
import { captureException } from '@/lib/observability/capture';
import { getRequestId } from '@/lib/observability/request-id';
import {
  LAYOUT_TEMPLATES,
  validateAlbumForPdf,
  type Block,
  type LayoutTemplate,
  type Overlay,
} from '@/lib/builder/model';

/**
 * Internal album-PDF generation service (service-role; NO per-user auth here — callers
 * MUST authorize first: admin action via requireAdmin, payment hooks via verified
 * webhook/signature, page loads via RLS ownership).
 *
 * PDF generation is a BACKEND workflow. This is the single place that mints a print
 * token, flips album_pdfs → 'generating', enqueues the job, and (best-effort) wakes the
 * sleeping Render worker. The worker's stuck-job sweep is the safety net that guarantees
 * a 'generating' row always converges to 'ready' or 'failed' (see worker/pdf-recovery).
 */

export type StartResult = { ok: true; skipped?: 'already-ready' | 'in-progress' } | { ok: false; error: string };

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
// A 'generating' row younger than this is considered actively in progress, so a
// non-forced request is a no-op (don't pile on duplicate jobs).
const IN_PROGRESS_MS = 90 * 1000;

type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: { overlays?: Overlay[] } | null;
};

const isTemplate = (t: string | null): t is LayoutTemplate =>
  !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

/**
 * Drive album-PDF generation.
 *
 * @param opts.force      regenerate even if a PDF already exists / is in progress (admin Regenerate).
 * @param opts.validate   re-run the completeness validator before generating (default true). Payment
 *                        hooks pass false — a paid album was already validated at submit.
 * @param opts.nudge      best-effort wake of the sleeping worker after enqueue (default true).
 */
export async function startAlbumPdfGeneration(
  albumId: string,
  opts?: { force?: boolean; validate?: boolean; nudge?: boolean },
): Promise<StartResult> {
  const force = opts?.force ?? false;
  const doValidate = opts?.validate ?? true;
  const doNudge = opts?.nudge ?? true;

  const svc = createServiceClient();

  const { data: albumRow } = await svc
    .from('albums')
    .select('id, size, cover_template_id')
    .eq('id', albumId)
    .maybeSingle();
  if (!albumRow) return { ok: false, error: 'Album not found' };
  const album = albumRow as { id: string; size: number; cover_template_id: string | null };

  // Idempotency: don't duplicate work for a non-forced caller.
  const { data: existing } = await svc
    .from('album_pdfs')
    .select('status, requested_at')
    .eq('album_id', albumId)
    .maybeSingle();
  const cur = existing as { status: string; requested_at: string | null } | null;
  if (!force && cur) {
    if (cur.status === 'ready') return { ok: true, skipped: 'already-ready' };
    if (
      cur.status === 'generating' &&
      cur.requested_at &&
      Date.now() - new Date(cur.requested_at).getTime() < IN_PROGRESS_MS
    ) {
      return { ok: true, skipped: 'in-progress' };
    }
  }

  // Fail-closed: never flip a row to 'generating' if no worker can ever run it. A
  // misconfigured (prod) worker → hard error; asleep → we still proceed (the nudge +
  // sweep will drive it once it wakes).
  const worker = await checkWorker();
  if (!worker.ready && worker.reason === 'misconfigured') {
    return { ok: false, error: 'PDF generation is temporarily unavailable. Please try again later.' };
  }

  if (doValidate) {
    let hasActiveCover = false;
    if (album.cover_template_id) {
      const { data: cover } = await svc
        .from('cover_templates')
        .select('id, image_key')
        .eq('id', album.cover_template_id)
        .maybeSingle();
      const c = cover as { id: string; image_key: string | null } | null;
      hasActiveCover = !!(c && c.image_key);
    }

    const { data: pageData } = await svc
      .from('album_pages')
      .select('page_number, layout_template, caption, photo_ids, layout_config')
      .eq('album_id', albumId)
      .order('page_number', { ascending: true });

    const blocks: Block[] = ((pageData ?? []) as PageRow[])
      .filter((r) => isTemplate(r.layout_template))
      .map((r) => ({
        key: `${r.page_number}`,
        template: r.layout_template as LayoutTemplate,
        photoIds: (r.photo_ids ?? []).filter(Boolean),
        caption: r.caption ?? '',
        overlays: r.layout_config?.overlays ?? [],
      }));

    const check = validateAlbumForPdf(blocks, album.size, hasActiveCover);
    if (!check.ok) return { ok: false, error: check.errors[0] };
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const tokenExpiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();

  // Flip to generating with a fresh attempt window. r2_key/generated_at are intentionally
  // omitted so any previously-generated PDF stays downloadable until the new one lands.
  const { error: upsertErr } = await svc.from('album_pdfs').upsert(
    {
      album_id: albumId,
      status: 'generating',
      error: null,
      token_hash: tokenHash,
      token_expires_at: tokenExpiresAt,
      token_used_at: null,
      requested_at: now.toISOString(),
      attempts: 1,
    },
    { onConflict: 'album_id' },
  );
  if (upsertErr) {
    console.error('[pdf] start upsert error', { albumId, error: upsertErr.message });
    void captureException(upsertErr, {
      source: 'album-pdf',
      category: 'pdf',
      severity: 'error',
      requestId: getRequestId(),
      metadata: { albumId, stage: 'start-upsert' },
    });
    return { ok: false, error: 'Could not start PDF generation.' };
  }

  try {
    const jobId = await enqueueAlbumPdf(albumId, token);
    console.log('[pdf] queued', {
      albumId,
      jobId,
      tokenHash: tokenHash.slice(0, 8),
      force,
      at: now.toISOString(),
    });
  } catch (e) {
    console.error('[pdf] enqueue failed', { albumId, error: String(e) });
    void captureException(e, {
      source: 'album-pdf',
      category: 'pdf',
      severity: 'error',
      requestId: getRequestId(),
      metadata: { albumId, stage: 'enqueue' },
    });
    await svc.from('album_pdfs').update({ status: 'failed', error: 'Could not enqueue job' }).eq('album_id', albumId);
    return { ok: false, error: 'Could not start PDF generation.' };
  }

  // Wake the (sleepable) Render worker so it drains the queue promptly. Best-effort:
  // the request itself nudges Render even if it times out, and the sweep is the backstop.
  if (doNudge) {
    probeWorker(2500).catch(() => {});
  }

  return { ok: true };
}
