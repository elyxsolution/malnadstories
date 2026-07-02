import { createHash } from 'node:crypto';
import { z } from 'zod';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { supabase } from '../supabase.js';
import { putObject } from '../r2.js';
import { env } from '../env.js';

const JobSchema = z.object({ albumId: z.string().uuid(), token: z.string().min(1) });

// ── Per-stage timeouts (ms). Every value is logged with its stage so a hang is
// always attributable. Tuned so the WHOLE job self-terminates well under the
// recovery sweep's 3-min stale window → a stuck job becomes status='failed' with a
// precise stage, never an indefinite 'generating'.
const QUERY_TIMEOUT_MS = 15_000; // each Supabase read/write
const LAUNCH_TIMEOUT_MS = 45_000; // puppeteer.launch (ws connect)
const PROTOCOL_TIMEOUT_MS = 90_000; // CDP ceiling for ALL page.* calls (newPage/evaluate/pdf)
const NEWPAGE_TIMEOUT_MS = 20_000;
const VIEWPORT_TIMEOUT_MS = 10_000;
const NAV_TIMEOUT_MS = 45_000; // page.goto
const READY_TIMEOUT_MS = 45_000; // waitForFunction(__ALBUM_PRINT_READY)
const INPAGE_SETTLE_MS = 12_000; // in-page fonts/decode budget (passed into evaluate)
const EVALUATE_TIMEOUT_MS = 25_000; // outer watchdog around page.evaluate
const PDF_TIMEOUT_MS = 60_000; // page.pdf
const UPLOAD_TIMEOUT_MS = 60_000; // R2 putObject
const PAGE_CLOSE_TIMEOUT_MS = 10_000;

// Shared headless Chromium, reused across jobs (launch is expensive). A FRESH page
// is opened and closed per job so memory doesn't leak between renders.
let browserPromise: Promise<Browser> | null = null;

// ── instrumentation helpers ───────────────────────────────────────────────────
class WatchdogTimeout extends Error {
  constructor(stage: string, ms: number) {
    super(`watchdog: stage '${stage}' exceeded ${ms}ms`);
    this.name = 'WatchdogTimeout';
  }
}

function mem(): { rssMB: number; heapMB: number; extMB: number } {
  const m = process.memoryUsage();
  return {
    rssMB: Math.round(m.rss / 1_048_576),
    heapMB: Math.round(m.heapUsed / 1_048_576),
    extMB: Math.round((m.external ?? 0) / 1_048_576),
  };
}

/**
 * Run `fn` with a hard timeout. On timeout it rejects with WatchdogTimeout AND calls
 * `onTimeout` (used to abort the underlying socket/CDP call so it doesn't leak). The
 * underlying promise is otherwise abandoned — the job fails fast rather than hanging.
 */
function withWatchdog<T>(stage: string, ms: number, fn: () => Promise<T>, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } catch {
        /* ignore */
      }
      reject(new WatchdogTimeout(stage, ms));
    }, ms);
    timer.unref?.();
    fn().then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Structured stage wrapper: logs "<stage> starting" (with the timeout) and either
 * "<stage> ok" or "<stage> FAILED" with elapsed-from-job-start, per-stage ms, current
 * memory, and — on failure — the FULL error, stack, and cause. Bounds `fn` by a
 * watchdog so no stage can hang forever.
 */
async function stage<T>(
  name: string,
  albumId: string,
  t0: number,
  timeoutMs: number,
  fn: () => Promise<T>,
  onTimeout?: () => void,
): Promise<T> {
  const s = Date.now();
  console.log(`[worker] album-pdf ${name} starting`, { albumId, elapsedMs: s - t0, timeoutMs, mem: mem() });
  try {
    const r = await withWatchdog(name, timeoutMs, fn, onTimeout);
    console.log(`[worker] album-pdf ${name} ok`, { albumId, elapsedMs: Date.now() - t0, stageMs: Date.now() - s, mem: mem() });
    return r;
  } catch (error) {
    console.error(`[worker] album-pdf ${name} FAILED`, {
      albumId,
      elapsedMs: Date.now() - t0,
      stageMs: Date.now() - s,
      timeoutMs,
      mem: mem(),
      error,
      stack: (error as Error)?.stack ?? null,
      cause: (error as { cause?: unknown })?.cause ?? null,
    });
    throw error;
  }
}

export async function getBrowser(): Promise<Browser> {
  const existing = await browserPromise?.catch(() => null);
  if (existing && existing.connected) return existing;
  browserPromise = puppeteer.launch({
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS, // bounds the browser-start / ws-connect itself
    protocolTimeout: PROTOCOL_TIMEOUT_MS, // bounds EVERY subsequent CDP call (newPage/evaluate/pdf)
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

/** Tear down the shared browser so the next job relaunches a clean Chromium. */
async function resetBrowser(): Promise<void> {
  const b = await browserPromise?.catch(() => null);
  browserPromise = null;
  if (b) {
    try {
      await withWatchdog('browser-reset-close', PAGE_CLOSE_TIMEOUT_MS, () => b.close());
    } catch {
      /* ignore — we're discarding it anyway */
    }
  }
}

/**
 * Mark the album's PDF failed. The DB write is ITSELF watchdog-bounded: the old
 * fail() awaited an unbounded Supabase update, so a network stall on the failure path
 * would leave status='generating' forever — exactly the bug class we're hardening.
 */
async function fail(albumId: string, t0: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[worker] album-pdf failed', {
    albumId,
    elapsedMs: Date.now() - t0,
    mem: mem(),
    error,
    stack: (error as Error)?.stack ?? null,
    cause: (error as { cause?: unknown })?.cause ?? null,
  });
  try {
    await withWatchdog('fail-db-update', QUERY_TIMEOUT_MS, async () => {
      const { error: e } = await supabase
        .from('album_pdfs')
        .update({ status: 'failed', error: message.slice(0, 500) })
        .eq('album_id', albumId);
      if (e) throw new Error(`fail() update error: ${e.message}`);
    });
  } catch (e) {
    // Could not even mark failed — the recovery sweep's stale-'generating' pass is the
    // last line of defense. Log loudly so this is visible.
    console.error('[worker] album-pdf fail() could NOT persist status (recovery sweep will catch it)', {
      albumId,
      error: e,
      stack: (e as Error)?.stack ?? null,
    });
  }
}

/**
 * Generate the album preview PDF: drive the print route with Puppeteer and upload the
 * result to R2. Every stage is logged (start/ok/FAILED) with elapsed ms + memory and
 * is bounded by a watchdog, so a stall is (a) attributable to an exact stage and (b)
 * can never leave the row stuck in 'generating'.
 */
export async function generateAlbumPdf(rawInput: unknown): Promise<void> {
  const t0 = Date.now();
  const parsed = JobSchema.safeParse(rawInput);
  if (!parsed.success) {
    console.error('[worker] invalid album-pdf payload, dropping:', parsed.error.issues[0]?.message);
    return;
  }
  const { albumId, token } = parsed.data;

  console.log('[worker] album-pdf job received', { albumId, mem: mem(), timeouts: {
    QUERY_TIMEOUT_MS, LAUNCH_TIMEOUT_MS, PROTOCOL_TIMEOUT_MS, NEWPAGE_TIMEOUT_MS, VIEWPORT_TIMEOUT_MS,
    NAV_TIMEOUT_MS, READY_TIMEOUT_MS, EVALUATE_TIMEOUT_MS, INPAGE_SETTLE_MS, PDF_TIMEOUT_MS, UPLOAD_TIMEOUT_MS,
  } });

  // ── pre-flight reads (now bounded) ──────────────────────────────────────────
  let userId: string;
  let stored: { token_hash: string | null; token_expires_at: string | null } | null;
  try {
    const album = await stage('album-fetch', albumId, t0, QUERY_TIMEOUT_MS, async () => {
      const { data, error } = await supabase.from('albums').select('id, user_id').eq('id', albumId).maybeSingle();
      if (error) throw new Error(`albums select error: ${error.message}`);
      return data as { user_id: string } | null;
    });
    if (!album) {
      await fail(albumId, t0, new Error('album not found'));
      return;
    }
    userId = album.user_id;

    const tokenHash = createHash('sha256').update(token).digest('hex');
    stored = await stage('token-fetch', albumId, t0, QUERY_TIMEOUT_MS, async () => {
      const { data, error } = await supabase
        .from('album_pdfs')
        .select('token_hash, token_expires_at')
        .eq('album_id', albumId)
        .maybeSingle();
      if (error) throw new Error(`album_pdfs select error: ${error.message}`);
      return data as { token_hash: string | null; token_expires_at: string | null } | null;
    });

    console.log('[worker] album-pdf start', {
      albumId,
      jobTokenHash: tokenHash.slice(0, 8),
      storedTokenHash: stored?.token_hash?.slice(0, 8) ?? null,
      tokenExpiresAt: stored?.token_expires_at ?? null,
      elapsedMs: Date.now() - t0,
    });

    // Stale-job guard: only the token currently stored may be processed.
    if (!stored || stored.token_hash !== tokenHash) {
      console.warn(`[worker] album-pdf skipping stale job for ${albumId} (token superseded by a newer request)`);
      return; // do NOT fail — a newer job owns the current token
    }
    if (!stored.token_expires_at || new Date(stored.token_expires_at).getTime() <= Date.now()) {
      await fail(albumId, t0, new Error('print token expired before generation'));
      return;
    }
  } catch (err) {
    await fail(albumId, t0, err);
    return;
  }

  // ── render pipeline ─────────────────────────────────────────────────────────
  let page: Page | null = null;
  let browserBroke = false;
  try {
    const browser = await stage('browser-launch', albumId, t0, LAUNCH_TIMEOUT_MS + 5_000, () => getBrowser());

    page = await stage('page-create', albumId, t0, NEWPAGE_TIMEOUT_MS, () => browser.newPage());
    const pg = page;

    await stage('viewport', albumId, t0, VIEWPORT_TIMEOUT_MS, () =>
      pg.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 }),
    );

    // Token rides in the URL only — log the path WITHOUT the token.
    const url = `${env.APP_URL}/albums/${albumId}/print?t=${encodeURIComponent(token)}`;
    console.log('[worker] album-pdf navigation', { albumId, url: `${env.APP_URL}/albums/${albumId}/print`, elapsedMs: Date.now() - t0 });

    const status = await stage('page-goto', albumId, t0, NAV_TIMEOUT_MS + 5_000, async () => {
      // page.goto has its OWN timeout (fires first with a precise Puppeteer error); the
      // watchdog is a backstop in case the CDP navigation promise never settles.
      const response = await pg.goto(url, { waitUntil: 'networkidle0', timeout: NAV_TIMEOUT_MS });
      if (!response || !response.ok()) {
        throw new Error(`print route returned HTTP ${response?.status() ?? 'no response'}`);
      }
      return response.status();
    });
    console.log('[worker] album-pdf page-goto http', { albumId, status, elapsedMs: Date.now() - t0 });

    await stage('readiness-flag', albumId, t0, READY_TIMEOUT_MS + 5_000, () =>
      pg.waitForFunction('window.__ALBUM_PRINT_READY === true', { timeout: READY_TIMEOUT_MS }),
    );

    // Deterministic paint: wait for fonts + image DECODE, but CAP the in-page wait so a
    // never-resolving font/decode can't hang (this was previously unbounded).
    await stage('readiness-decode', albumId, t0, EVALUATE_TIMEOUT_MS, () =>
      pg.evaluate(async (capMs: number) => {
        const cap = new Promise<void>((r) => setTimeout(r, capMs));
        const fontsReady = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
        await Promise.race([fontsReady, cap]);
        const decodes = Promise.all(
          Array.from(document.images).map((img) =>
            img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined),
          ),
        );
        await Promise.race([decodes, cap]);
      }, INPAGE_SETTLE_MS),
    );

    const pdf = await stage('pdf-render', albumId, t0, PDF_TIMEOUT_MS, () =>
      pg.pdf({ printBackground: true, preferCSSPageSize: true }),
    );
    const buf = Buffer.from(pdf);
    console.log('[worker] album-pdf pdf-size', { albumId, bytes: buf.length, kb: Math.round(buf.length / 1024), elapsedMs: Date.now() - t0, mem: mem() });
    if (buf.length === 0) throw new Error('page.pdf produced 0 bytes');

    const key = `${userId}/albums/${albumId}/preview.pdf`;
    const ac = new AbortController();
    await stage('r2-upload', albumId, t0, UPLOAD_TIMEOUT_MS, () => putObject(key, buf, 'application/pdf', ac.signal), () => ac.abort());

    await stage('db-update', albumId, t0, QUERY_TIMEOUT_MS, async () => {
      const { error } = await supabase
        .from('album_pdfs')
        .update({ status: 'ready', r2_key: key, generated_at: new Date().toISOString(), error: null })
        .eq('album_id', albumId);
      if (error) throw new Error(`db update failed: ${error.message}`);
    });

    console.log('[worker] album-pdf SUCCESS', { albumId, totalMs: Date.now() - t0, bytes: buf.length, mem: mem() });
  } catch (err) {
    // A browser/page-level watchdog means Chromium may be wedged — discard it so the
    // next attempt relaunches clean.
    if (err instanceof WatchdogTimeout && /browser-launch|page-create|viewport|page-goto|readiness|pdf-render/.test(err.message)) {
      browserBroke = true;
    }
    await fail(albumId, t0, err);
  } finally {
    if (page) {
      try {
        await withWatchdog('page-close', PAGE_CLOSE_TIMEOUT_MS, () => page!.close());
      } catch (e) {
        console.error('[worker] album-pdf page-close FAILED', { albumId, error: e, stack: (e as Error)?.stack ?? null });
        browserBroke = true;
      }
    }
    if (browserBroke) await resetBrowser();
  }
}

export async function closeBrowser(): Promise<void> {
  await resetBrowser();
}
