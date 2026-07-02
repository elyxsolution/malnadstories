import type PgBoss from 'pg-boss';
import {
  createBoss,
  IMAGE_HARDENING_QUEUE,
  ALBUM_PDF_QUEUE,
  R2_CLEANUP_QUEUE,
  COVER_THUMBNAIL_QUEUE,
  BLUEPRINT_THUMBNAIL_QUEUE,
  type ImageHardeningJob,
  type AlbumPdfJob,
  type R2CleanupJob,
  type CoverThumbnailJob,
  type BlueprintThumbnailJob,
} from './queue.js';
import { processPhoto } from './jobs/image-hardening.js';
import { generateAlbumPdf, closeBrowser } from './jobs/album-pdf.js';
import { cleanupR2 } from './jobs/r2-cleanup.js';
import { generateCoverThumbnail } from './jobs/cover-thumbnail.js';
import { generateBlueprintThumbnail } from './jobs/blueprint-thumbnail.js';
import { sweepPdfs } from './jobs/pdf-recovery.js';
import { startHealthServer } from './health-server.js';
import { supabase } from './supabase.js';
import { env } from './env.js';
import { captureException, recordTiming, jobRequestId, PERF } from './lib/observability.js';

const SEND_OPTS = { retryLimit: 3, retryDelay: 30, retryBackoff: true } as const;

/**
 * Self-healing sweep: re-enqueue any 'pending' photo with a raw object (covers a
 * missed enqueue from the app, a worker restart, or legacy rows from before the
 * pipeline existed). singletonKey dedupes against an already-queued job per photo.
 */
async function sweepPending(boss: PgBoss): Promise<void> {
  const { data, error } = await supabase
    .from('photos')
    .select('id')
    .eq('status', 'pending')
    .not('r2_key', 'is', null)
    .limit(500);
  if (error) {
    console.error('[worker] sweep query failed:', error.message);
    return;
  }
  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return;
  console.log(`[worker] sweeping ${rows.length} pending photo(s)`);
  for (const r of rows) {
    await boss.send(IMAGE_HARDENING_QUEUE, { photoId: r.id }, { ...SEND_OPTS, singletonKey: r.id });
  }
}

async function main(): Promise<void> {
  // Bind the availability port immediately so an inbound wake-up request (Render
  // routing / the app's readiness probe) is answered the moment the process is up.
  startHealthServer();

  const boss = createBoss();
  boss.on('error', (e) => console.error('[worker] pg-boss error:', e));
  await boss.start();
  await boss.createQueue(IMAGE_HARDENING_QUEUE);
  await boss.createQueue(ALBUM_PDF_QUEUE);
  await boss.createQueue(R2_CLEANUP_QUEUE);
  await boss.createQueue(COVER_THUMBNAIL_QUEUE);
  await boss.createQueue(BLUEPRINT_THUMBNAIL_QUEUE);

  await boss.work<ImageHardeningJob>(
    IMAGE_HARDENING_QUEUE,
    { pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        const rid = jobRequestId(IMAGE_HARDENING_QUEUE);
        const t0 = Date.now();
        try {
          await processPhoto(job.data);
          await recordTiming('image-hardening', 'process', Date.now() - t0, PERF.slowUploadMs, {
            requestId: rid,
            metadata: { photoId: job.data.photoId },
          });
        } catch (e) {
          // Capture then RETHROW so pg-boss retry behavior is unchanged.
          await captureException(e, {
            source: 'image-hardening',
            category: 'upload',
            severity: 'error',
            requestId: rid,
            metadata: { photoId: job.data.photoId },
          });
          throw e;
        }
      }
    },
  );

  // PDF jobs are heavy (Chromium); process one at a time.
  await boss.work<AlbumPdfJob>(
    ALBUM_PDF_QUEUE,
    { pollingIntervalSeconds: 2, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const rid = jobRequestId(ALBUM_PDF_QUEUE);
        const t0 = Date.now();
        try {
          await generateAlbumPdf(job.data);
          await recordTiming('album-pdf', 'render', Date.now() - t0, PERF.slowPdfMs, {
            requestId: rid,
            metadata: { albumId: job.data.albumId },
          });
        } catch (e) {
          await captureException(e, {
            source: 'album-pdf',
            category: 'pdf',
            severity: 'error',
            requestId: rid,
            metadata: { albumId: job.data.albumId },
          });
          throw e;
        }
      }
    },
  );

  await boss.work<R2CleanupJob>(
    R2_CLEANUP_QUEUE,
    { pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await cleanupR2(job.data);
        } catch (e) {
          await captureException(e, {
            source: 'r2-cleanup',
            category: 'system',
            severity: 'error',
            requestId: jobRequestId(R2_CLEANUP_QUEUE),
          });
          throw e;
        }
      }
    },
  );

  await boss.work<CoverThumbnailJob>(
    COVER_THUMBNAIL_QUEUE,
    { pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await generateCoverThumbnail(job.data);
        } catch (e) {
          await captureException(e, {
            source: 'cover-thumbnail',
            category: 'upload',
            severity: 'error',
            requestId: jobRequestId(COVER_THUMBNAIL_QUEUE),
          });
          throw e;
        }
      }
    },
  );

  // Blueprint thumbnails (0044) — heavy (Chromium); process one at a time, like album-pdf.
  await boss.work<BlueprintThumbnailJob>(
    BLUEPRINT_THUMBNAIL_QUEUE,
    { pollingIntervalSeconds: 2, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await generateBlueprintThumbnail(job.data);
        } catch (e) {
          await captureException(e, {
            source: 'blueprint-thumbnail',
            category: 'system',
            severity: 'error',
            requestId: jobRequestId(BLUEPRINT_THUMBNAIL_QUEUE),
            metadata: { blueprintId: job.data.blueprintId },
          });
          throw e;
        }
      }
    },
  );

  console.log('[worker] image-hardening + album-pdf + r2-cleanup + cover-thumbnail + blueprint-thumbnail workers started');

  await sweepPending(boss);
  await sweepPdfs(boss).catch((e) => console.error('[worker] pdf-recovery sweep error:', e));
  const timer = setInterval(() => {
    sweepPending(boss).catch((e) => console.error('[worker] sweep error:', e));
    sweepPdfs(boss).catch((e) => console.error('[worker] pdf-recovery sweep error:', e));
  }, env.WORKER_SWEEP_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(timer);
    await boss.stop({ graceful: true }).catch(() => {});
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Last-resort capture for stray async failures (log-and-continue; crash semantics unchanged).
  process.on('unhandledRejection', (reason) => {
    console.error('[worker] unhandledRejection:', reason);
    void captureException(reason, {
      source: 'worker',
      category: 'system',
      severity: 'critical',
      metadata: { kind: 'unhandledRejection' },
    });
  });
}

main().catch(async (e) => {
  console.error('[worker] fatal:', e);
  // Best-effort capture before exit (await so it has a chance to land).
  await captureException(e, { source: 'worker', category: 'system', severity: 'critical', metadata: { kind: 'fatal-boot' } }).catch(() => {});
  process.exit(1);
});
