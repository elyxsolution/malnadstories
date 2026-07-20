import { randomBytes, createHash } from 'node:crypto';
import type PgBoss from 'pg-boss';
import { supabase } from '../supabase.js';
import { ALBUM_PDF_QUEUE } from '../queue.js';

/**
 * Album-PDF recovery sweep (reliability layer).
 *
 * PDF generation is a backend workflow that can stall in exactly one place: a row left
 * in `status='generating'` whose job never completed — the worker was asleep when the
 * job was enqueued and it expired, the worker crashed mid-render (Chromium OOM), or the
 * print token expired before pickup. There is no customer button to retry anymore, so
 * THIS sweep is what guarantees a 'generating' row always converges to 'ready' or
 * 'failed'. It runs on worker boot and on the periodic timer (only while the worker is
 * awake — which is exactly when jobs can be drained).
 *
 * Two responsibilities:
 *   1. STUCK: re-drive any 'generating' row older than the timeout, capped by `attempts`
 *      → after the cap it becomes 'failed' (admin-recoverable) instead of looping forever.
 *   2. PAID-HEAL: ensure every PAID album has a PDF — (re)start albums that are paid but
 *      have no row / are 'idle' / 'failed' (under the attempt cap). Makes the system
 *      self-healing even if the payment-time enqueue+nudge was lost.
 */

// A generation in flight longer than this is considered stuck. CRITICAL INVARIANT (audit C-1):
// this MUST exceed the album-pdf job's worst-case self-terminating budget — the SUM of its per-stage
// watchdogs (~340s, see album-pdf.ts). At the old 180s it was SMALLER than that budget, so the sweep
// re-drove jobs that were still legitimately rendering → redundant re-renders + attempts inflation →
// spurious 'failed'. At 7 min the sweep can only ever act AFTER a job has definitively terminated
// (either succeeded, or hit its own watchdogs and called fail()), never racing a live render.
const PDF_STALE_MS = 7 * 60 * 1000; // 420s > ~340s max job budget
const MAX_ATTEMPTS = 5;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const BATCH = 200;

// Mirror src/lib/orders/album-lock PAID_STATES, widened to the full paid-or-further set
// so an order already in printing/packed still gets its PDF ensured.
const PAID_STATUSES = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'];

type PdfRow = { album_id: string; status: string; requested_at: string | null; attempts: number | null };

/** Mint a fresh token, flip the row to 'generating', and enqueue a job. */
async function redrive(boss: PgBoss, albumId: string, attempts: number): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();

  const { error } = await supabase.from('album_pdfs').upsert(
    {
      album_id: albumId,
      status: 'generating',
      stage: 'queued',
      failure_code: null,
      error: null,
      token_hash: tokenHash,
      token_expires_at: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
      token_used_at: null,
      requested_at: now.toISOString(),
      attempts,
    },
    { onConflict: 'album_id' },
  );
  if (error) {
    console.error('[worker] pdf-recovery redrive upsert failed', { albumId, error: error.message });
    return;
  }
  await boss.send(ALBUM_PDF_QUEUE, { albumId, token }, { retryLimit: 0 });
  console.log('[worker] pdf-recovery queued', { albumId, attempts, tokenHash: tokenHash.slice(0, 8) });
}

async function sweepStuck(boss: PgBoss): Promise<void> {
  const { data, error } = await supabase
    .from('album_pdfs')
    .select('album_id, status, requested_at, attempts')
    .eq('status', 'generating')
    .limit(BATCH);
  if (error) {
    console.error('[worker] pdf-recovery stuck query failed:', error.message);
    return;
  }

  const now = Date.now();
  for (const r of (data ?? []) as PdfRow[]) {
    const startedAt = r.requested_at ? new Date(r.requested_at).getTime() : 0;
    const age = now - startedAt;
    if (age <= PDF_STALE_MS) continue; // healthy in-flight render — leave it alone

    const attempts = r.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      await supabase
        .from('album_pdfs')
        .update({ status: 'failed', error: `generation timed out after ${attempts} attempts` })
        .eq('album_id', r.album_id);
      console.error('[worker] pdf-recovery giving up → failed', { albumId: r.album_id, attempts });
      continue;
    }
    console.warn('[worker] pdf-recovery re-driving stuck generation', { albumId: r.album_id, ageMs: age, attempts });
    await redrive(boss, r.album_id, attempts + 1);
  }
}

async function healPaid(boss: PgBoss): Promise<void> {
  // Distinct paid album ids.
  const { data: orderData, error: orderErr } = await supabase
    .from('orders')
    .select('album_id')
    .in('status', PAID_STATUSES)
    .limit(1000);
  if (orderErr) {
    console.error('[worker] pdf-recovery paid query failed:', orderErr.message);
    return;
  }
  const albumIds = Array.from(new Set((orderData ?? []).map((o) => (o as { album_id: string }).album_id))).filter(
    Boolean,
  );
  if (albumIds.length === 0) return;

  const { data: pdfData, error: pdfErr } = await supabase
    .from('album_pdfs')
    .select('album_id, status, requested_at, attempts')
    .in('album_id', albumIds);
  if (pdfErr) {
    console.error('[worker] pdf-recovery paid pdf query failed:', pdfErr.message);
    return;
  }
  const byAlbum = new Map<string, PdfRow>();
  for (const r of (pdfData ?? []) as PdfRow[]) byAlbum.set(r.album_id, r);

  for (const albumId of albumIds) {
    const row = byAlbum.get(albumId);
    if (!row) {
      // Paid but never generated → start it.
      console.log('[worker] pdf-recovery paid-heal: missing PDF, starting', { albumId });
      await redrive(boss, albumId, 1);
      continue;
    }
    if (row.status === 'ready' || row.status === 'generating') continue; // fine / in progress
    // idle or failed (under the cap) → (re)start. 'failed' at the cap is left for admin.
    const attempts = row.attempts ?? 0;
    if (row.status === 'failed' && attempts >= MAX_ATTEMPTS) continue;
    console.log('[worker] pdf-recovery paid-heal: (re)starting', { albumId, status: row.status, attempts });
    await redrive(boss, albumId, row.status === 'idle' ? 1 : attempts + 1);
  }
}

/** Run both recovery passes. Safe to call repeatedly; idempotent under the stale guard. */
export async function sweepPdfs(boss: PgBoss): Promise<void> {
  await sweepStuck(boss);
  await healPaid(boss);
}
