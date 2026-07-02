import 'server-only';
import PgBoss from 'pg-boss';

/**
 * App-side pg-boss — ENQUEUE ONLY. The long-running /worker service consumes.
 *
 * A module-level singleton started once and reused across requests (the dev/Node
 * server is long-lived). Constructed send-only (`supervise:false, schedule:false`)
 * so it never runs queue maintenance — that's the worker's job.
 *
 * Uses DIRECT_URL: pg-boss needs a SESSION connection (port 5432), not the 6543
 * transaction pooler.
 *
 * NOTE (deploy phase): on serverless (e.g. Vercel) each instance would hold a
 * DIRECT_URL session connection, which can exhaust Supabase's direct-connection
 * limit. Revisit the enqueue strategy before deploying (e.g. a dedicated enqueue
 * endpoint, a connection-pooled sender, or HTTP-based job submission).
 */
export const IMAGE_HARDENING_QUEUE = 'image-hardening';
export const ALBUM_PDF_QUEUE = 'album-pdf';
export const R2_CLEANUP_QUEUE = 'r2-cleanup';
export const COVER_THUMBNAIL_QUEUE = 'cover-thumbnail';
export const BLUEPRINT_THUMBNAIL_QUEUE = 'blueprint-thumbnail';

let bossPromise: Promise<PgBoss> | null = null;

function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DIRECT_URL!,
        supervise: false,
        schedule: false,
      });
      boss.on('error', (e) => console.error('pg-boss (app) error:', e));
      await boss.start();
      await boss.createQueue(IMAGE_HARDENING_QUEUE);
      await boss.createQueue(ALBUM_PDF_QUEUE);
      await boss.createQueue(R2_CLEANUP_QUEUE);
      await boss.createQueue(COVER_THUMBNAIL_QUEUE);
      await boss.createQueue(BLUEPRINT_THUMBNAIL_QUEUE);
      return boss;
    })().catch((e) => {
      bossPromise = null; // allow a later retry if startup failed
      throw e;
    });
  }
  return bossPromise;
}

/** Enqueue image hardening for one photo. singletonKey dedupes per photo. */
export async function enqueueImageHardening(photoId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(
    IMAGE_HARDENING_QUEUE,
    { photoId },
    { retryLimit: 3, retryDelay: 30, retryBackoff: true, singletonKey: photoId },
  );
}

/**
 * Enqueue album PDF generation. The raw print token rides in the payload (the pgboss
 * tables live in the trusted DB). retryLimit 0: no retries.
 *
 * NO singletonKey: it would drop the new job when an older album-pdf job for the same
 * album is still queued, leaving the newest token with no job while a STALE job runs
 * with an outdated token (→ HTTP 404 at the print route). Instead every request gets
 * its own job, and the worker processes only the job whose token still matches the
 * current album_pdfs row (older jobs skip). Returns the job id for diagnostics.
 */
export async function enqueueAlbumPdf(albumId: string, token: string): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(ALBUM_PDF_QUEUE, { albumId, token }, { retryLimit: 0 });
}

/**
 * Enqueue deletion of a list of R2 object keys (album cleanup). The worker deletes
 * each key idempotently; transient failures retry. We hand the key list to the
 * worker instead of deleting many objects in the request so the UI returns at once
 * and cleanup is reliable.
 */
export async function enqueueR2Cleanup(keys: string[]): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(R2_CLEANUP_QUEUE, { keys }, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
}

/**
 * Enqueue thumbnail + dimension extraction for a newly-uploaded cover template.
 * singletonKey dedupes per cover; transient failures retry. Best-effort from the
 * admin createCover action — if it never runs, pickers fall back to the master image.
 */
export async function enqueueCoverThumbnail(coverTemplateId: string): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    COVER_THUMBNAIL_QUEUE,
    { coverTemplateId },
    { retryLimit: 3, retryDelay: 30, retryBackoff: true, singletonKey: coverTemplateId },
  );
}

/**
 * Enqueue blueprint thumbnail generation (0044). The raw render token rides in the payload; the
 * worker validates it against the CURRENT stored hash, so — like album-pdf — NO singletonKey (a
 * newer request must not be dropped in favour of a stale-token job). retryLimit 2 covers transient
 * render/upload failures; the token TTL bounds staleness. Best-effort from the blueprint actions.
 */
export async function enqueueBlueprintThumbnail(blueprintId: string, token: string): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(BLUEPRINT_THUMBNAIL_QUEUE, { blueprintId, token }, { retryLimit: 2, retryDelay: 20, retryBackoff: true });
}
