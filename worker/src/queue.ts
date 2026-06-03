import PgBoss from 'pg-boss';
import { env } from './env.js';

/**
 * The single queue name, shared by intent with the app's enqueue side
 * (src/lib/queue.ts). It's a plain string literal in both places — not worth
 * coupling the two packages just to share one constant.
 */
export const IMAGE_HARDENING_QUEUE = 'image-hardening';
export const ALBUM_PDF_QUEUE = 'album-pdf';

export type ImageHardeningJob = { photoId: string };
export type AlbumPdfJob = { albumId: string; token: string };

/**
 * Worker-side pg-boss instance. Connects with DIRECT_URL — a SESSION connection
 * (port 5432). pg-boss relies on LISTEN/NOTIFY + advisory locks, which break under
 * the pgBouncer transaction pooler (port 6543). pg-boss creates/owns its `pgboss`
 * schema automatically on start.
 */
export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: env.DIRECT_URL });
}
