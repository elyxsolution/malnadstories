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
 * Enqueue album PDF generation. The raw single-use print token rides in the payload
 * (the pgboss tables live in the trusted DB). retryLimit 0 keeps the token truly
 * single-use — a failure surfaces as status='failed' and the user re-requests.
 * singletonKey collapses double-clicks into one job.
 */
export async function enqueueAlbumPdf(albumId: string, token: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(ALBUM_PDF_QUEUE, { albumId, token }, { retryLimit: 0, singletonKey: albumId });
}
