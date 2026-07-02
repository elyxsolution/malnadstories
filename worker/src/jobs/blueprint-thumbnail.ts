import { createHash } from 'node:crypto';
import { z } from 'zod';
import sharp from 'sharp';
import { type Page } from 'puppeteer';
import { supabase } from '../supabase.js';
import { putObject } from '../r2.js';
import { env } from '../env.js';
import { getBrowser } from './album-pdf.js';

/**
 * Blueprint thumbnail job (0044). Reuses the SAME architecture as album-pdf: the shared headless
 * Chromium screenshots a token-gated render route (which renders the blueprint through the app's
 * EXISTING renderer), then Sharp optimizes a preview + thumbnail and both upload to R2. thumb_key
 * is updated so the picker/admin prefer the cached image; on any failure it stays null (the UI
 * falls back to a count placeholder). Idempotent: re-running overwrites the same R2 keys.
 */
const JobSchema = z.object({ blueprintId: z.string().uuid(), token: z.string().min(1) });

const NAV_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 20_000;

export async function generateBlueprintThumbnail(rawInput: unknown): Promise<void> {
  const parsed = JobSchema.safeParse(rawInput);
  if (!parsed.success) {
    console.error('[worker] invalid blueprint-thumbnail payload, dropping:', parsed.error.issues[0]?.message);
    return;
  }
  const { blueprintId, token } = parsed.data;

  // Stale-token guard: only the token currently stored may be processed (a newer request supersedes).
  const { data, error } = await supabase
    .from('layout_templates')
    .select('preview_token_hash, preview_token_expires_at')
    .eq('id', blueprintId)
    .maybeSingle();
  if (error) throw new Error(`blueprint-thumbnail: load failed: ${error.message}`); // transient → retry
  const row = data as { preview_token_hash: string | null; preview_token_expires_at: string | null } | null;
  if (!row) {
    console.warn(`[worker] blueprint-thumbnail: ${blueprintId} not found — skipping`);
    return;
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');
  if (row.preview_token_hash !== tokenHash) {
    console.warn(`[worker] blueprint-thumbnail: stale token for ${blueprintId} — skipping (superseded)`);
    return; // do NOT fail — a newer job owns the current token
  }
  if (!row.preview_token_expires_at || new Date(row.preview_token_expires_at).getTime() <= Date.now()) {
    console.warn(`[worker] blueprint-thumbnail: token expired for ${blueprintId} — skipping`);
    return;
  }

  const browser = await getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

    const url = `${env.APP_URL}/blueprints/${blueprintId}/preview?t=${encodeURIComponent(token)}`;
    console.log('[worker] blueprint-thumbnail navigation', { blueprintId, url: `${env.APP_URL}/blueprints/${blueprintId}/preview` });
    const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: NAV_TIMEOUT_MS });
    if (!resp || !resp.ok()) throw new Error(`preview route returned HTTP ${resp?.status() ?? 'no response'}`);

    await page.waitForFunction('window.__BLUEPRINT_PREVIEW_READY === true', { timeout: READY_TIMEOUT_MS });

    // Screenshot the rendered preview container (clip to content), then Sharp → optimized derivatives.
    const shot = Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));

    const preview = await sharp(shot)
      .resize({ width: 1000, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const thumb = await sharp(shot)
      .resize({ width: 480, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();

    const previewKey = `blueprints/${blueprintId}/preview.jpg`;
    const thumbKey = `blueprints/${blueprintId}/thumb.jpg`;
    await putObject(previewKey, preview, 'image/jpeg');
    await putObject(thumbKey, thumb, 'image/jpeg');

    // thumb_key drives the picker/admin; clear the one-time token so it can't be reused.
    const { error: updErr } = await supabase
      .from('layout_templates')
      .update({ thumb_key: thumbKey, preview_token_hash: null, preview_token_expires_at: null })
      .eq('id', blueprintId);
    if (updErr) throw new Error(`blueprint-thumbnail: db update failed: ${updErr.message}`);

    console.log('[worker] blueprint-thumbnail ready', { blueprintId, thumbKey, bytes: thumb.length });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
