import { z } from 'zod';
import puppeteer, { type Browser } from 'puppeteer';
import { supabase } from '../supabase.js';
import { putObject } from '../r2.js';
import { env } from '../env.js';

const JobSchema = z.object({ albumId: z.string().uuid(), token: z.string().min(1) });

// How long to wait for the print route to signal readiness before failing cleanly.
const READY_TIMEOUT_MS = 60_000;

// Shared headless Chromium, reused across jobs (launch is expensive). A FRESH page
// is opened and closed per job so memory doesn't leak between renders.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  const existing = await browserPromise?.catch(() => null);
  if (existing && existing.connected) return existing;
  browserPromise = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

async function fail(albumId: string, error: string) {
  console.error(`[worker] album-pdf failed for ${albumId}: ${error}`);
  await supabase.from('album_pdfs').update({ status: 'failed', error }).eq('album_id', albumId);
}

/**
 * Generate the album preview PDF: drive the print route with Puppeteer (which just
 * prints what the browser renders — no duplicated rendering logic) and upload the
 * result to R2. retryLimit is 0 (the print token is single-use), so any failure is
 * final and surfaces as status='failed' for the user to re-request.
 */
export async function generateAlbumPdf(rawInput: unknown): Promise<void> {
  const parsed = JobSchema.safeParse(rawInput);
  if (!parsed.success) {
    console.error('[worker] invalid album-pdf payload, dropping:', parsed.error.issues[0]?.message);
    return;
  }
  const { albumId, token } = parsed.data;

  // Look up the owner for the R2 key. (Never log the token.)
  const { data: album } = await supabase.from('albums').select('id, user_id').eq('id', albumId).maybeSingle();
  if (!album) {
    await fail(albumId, 'album not found');
    return;
  }
  const userId = (album as { user_id: string }).user_id;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });

    // Token rides in the URL only; it is never written to logs.
    const url = `${env.APP_URL}/albums/${albumId}/print?t=${encodeURIComponent(token)}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: READY_TIMEOUT_MS });
    await page.waitForFunction('window.__ALBUM_PRINT_READY === true', { timeout: READY_TIMEOUT_MS });

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });

    const key = `${userId}/albums/${albumId}/preview.pdf`;
    await putObject(key, Buffer.from(pdf), 'application/pdf');

    const { error } = await supabase
      .from('album_pdfs')
      .update({ status: 'ready', r2_key: key, generated_at: new Date().toISOString(), error: null })
      .eq('album_id', albumId);
    if (error) {
      await fail(albumId, `db update failed: ${error.message}`);
      return;
    }

    console.log(`[worker] album-pdf ready for ${albumId}`);
  } catch (err) {
    await fail(albumId, err instanceof Error ? err.message : 'unknown error');
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  const b = await browserPromise?.catch(() => null);
  if (b) await b.close().catch(() => {});
  browserPromise = null;
}
