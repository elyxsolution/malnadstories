/**
 * FULL PDF PIPELINE — end-to-end runtime verification for all three kinds.
 *
 *   APP_URL=http://localhost:3002 pnpm --filter @workerv2/app exec \
 *     tsx scripts/verify-pdf-pipeline.ts <albumId> [kind...]
 *
 * Runs the REAL `PdfProcessor` — real six-stage pipeline, real Puppeteer/Chromium, real R2 object
 * store, real Postgres — against a real album, mirroring what `startAlbumPdfGeneration` sets up
 * (mint token → flip the row to `generating`) and then invoking the processor DIRECTLY instead of
 * going through pg-boss.
 *
 * Bypassing the queue is deliberate and is the only difference from production: it removes
 * contention with any other worker already consuming `album-pdf`, so the result is attributable to
 * THIS configuration. Everything downstream of the job payload is untouched.
 *
 * A DIAGNOSTIC, not a test: it launches a browser, writes `album_pdfs` rows and uploads to R2 —
 * exactly what the admin console's Generate button does.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { Browser } from 'puppeteer';
import { loadEnvFiles } from '../src/env.js';
import { loadInfrastructureConfig } from '../src/infra/config.js';
import { R2ObjectStore } from '../src/infra/storage/r2-object-store.js';
import { SupabasePostgresAdapter, postgresSqlClient } from '../src/infra/database/supabase-adapter.js';
import { PuppeteerPageRenderer } from '../src/processors/pdf/puppeteer-renderer.js';
import { createPdfProcessor } from '../src/processors/pdf/pdf-processor.js';
import { PDF_KINDS, albumPdfKey, type PdfKind } from '../src/processors/pdf/pdf-contract.js';
import { noopLogger } from '@workerv2/worker-runtime';

const ALBUM = process.argv[2];
const KINDS = (process.argv.slice(3).length ? process.argv.slice(3) : [...PDF_KINDS]) as PdfKind[];
if (!ALBUM) {
  console.error('usage: tsx scripts/verify-pdf-pipeline.ts <albumId> [kind...]');
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFiles();
  const infra = loadInfrastructureConfig(process.env);
  if (infra === null) throw new Error('WV2_INFRA is not enabled');

  console.log(`\nrender base URL : ${infra.render.appUrl}  (${infra.render.appUrlSource})`);
  console.log(`album           : ${ALBUM}\n`);

  const sql = postgresSqlClient(infra.database);
  const database = new SupabasePostgresAdapter(sql);
  const objectStore = R2ObjectStore.fromConfig(infra.storage);

  const puppeteer = await import('puppeteer');
  const browser: Browser = await puppeteer.default.launch({
    headless: 'shell',
    args: ['--no-sandbox'],
  });
  const renderer = new PuppeteerPageRenderer({
    acquire: async () => browser,
    reset: async () => {},
  } as never);

  const processor = createPdfProcessor({
    database,
    objectStore,
    renderer,
    appUrl: infra.render.appUrl,
    logger: noopLogger,
  });

  let failures = 0;
  for (const kind of KINDS) {
    // Exactly what startAlbumPdfGeneration does before enqueuing.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await database.query(
      `insert into album_pdfs (album_id, kind, status, stage, failure_code, error,
                               token_hash, token_expires_at, token_used_at, requested_at, attempts)
       values ($1, $2, 'generating', 'queued', null, null, $3, $4, null, now(), 1)
       on conflict (album_id, kind) do update set
         status='generating', stage='queued', failure_code=null, error=null,
         token_hash=excluded.token_hash, token_expires_at=excluded.token_expires_at,
         token_used_at=null, requested_at=now(), attempts=1`,
      [ALBUM, kind, tokenHash, expires],
    );

    const started = Date.now();
    await processor.process({
      id: `verify-${kind}`,
      type: 'album-pdf',
      payload: { albumId: ALBUM, token, kind },
      metadata: { correlationId: `verify-${kind}`, attempt: 1 },
      enqueuedAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    } as never);

    const rows = await database.query<{
      status: string;
      stage: string | null;
      failure_code: string | null;
      error: string | null;
      r2_key: string | null;
    }>(
      `select status, stage, failure_code, error, r2_key from album_pdfs
        where album_id = $1 and kind = $2`,
      [ALBUM, kind],
    );
    const row = rows[0]!;
    const ok = row.status === 'ready';
    if (!ok) failures++;
    console.log(
      `  ${ok ? '✓' : '✗'} ${kind.padEnd(14)} status=${row.status.padEnd(9)} stage=${String(row.stage).padEnd(10)} ${Date.now() - started}ms`,
    );
    if (row.r2_key) console.log(`      r2_key: ${row.r2_key}`);
    if (row.failure_code) console.log(`      failure_code: ${row.failure_code}`);
    if (row.error) console.log(`      error: ${row.error}`);
    if (ok) {
      // The key must be the deterministic one for this kind — proves kind routing end to end.
      const owner = await database.query<{ user_id: string }>(
        'select user_id from albums where id = $1',
        [ALBUM],
      );
      const expected = albumPdfKey(owner[0]!.user_id, ALBUM, kind);
      console.log(`      key matches contract: ${row.r2_key === expected}`);
    }
  }

  await browser.close();
  await (sql as unknown as { end: () => Promise<void> }).end();
  console.log(failures === 0 ? '\nALL KINDS GENERATED\n' : `\n${failures} KIND(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
