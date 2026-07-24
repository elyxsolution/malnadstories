import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { DatabaseAdapter } from '../../infra/database/database-adapter.js';
import type { JobProducer } from '../../infra/queue/pgboss-queue.js';
import type { CancellationToken } from '../../recovery/cancellation.js';
import type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryResult,
} from '../../recovery/recoverable.js';
import type { PhotoStore } from './photo-repository.js';
import { PhotoRepository } from './photo-repository.js';
import { IMAGE_HARDENING_TYPE } from './image-processor.js';

/**
 * IMAGE RECOVERY — the `RecoverableProcessor` for image hardening. It centralizes the two healing
 * conditions that used to live (partly) in the processor's hot path:
 *
 *   • `stale-pending` — a photo uploaded but never hardened (the enqueue was lost, or the worker was
 *     asleep when the job expired). Heal by RE-ENQUEUING the hardening job.
 *   • `orphan-raw`    — a `ready` photo whose raw key is still set (a prior run crashed between
 *     mark-ready and raw-delete). Heal by finishing the deferred cleanup (delete raw + clear the key).
 *     This is the reconcile logic MOVED OUT of `ImageProcessor` — the processor now just processes.
 *
 * Every heal re-reads the row first, so it is idempotent and race-safe against live processing.
 */
export interface ImageRecoveryDeps {
  readonly photos: PhotoStore;
  readonly objectStore: ObjectStore;
  readonly producer: JobProducer;
  readonly logger: StructuredLogger;
  /** A `pending` photo older than this is considered stuck. */
  readonly stalePendingMs: number;
}

export class ImageRecoverableProcessor implements RecoverableProcessor {
  readonly name = IMAGE_HARDENING_TYPE;

  constructor(private readonly deps: ImageRecoveryDeps) {}

  async detectStale(limit: number, _token: CancellationToken): Promise<readonly RecoveryItem[]> {
    const cutoff = new Date(Date.now() - this.deps.stalePendingMs);
    const [pending, orphaned] = await Promise.all([
      this.deps.photos.findStalePending(cutoff, limit),
      this.deps.photos.findReadyNeedingCleanup(limit),
    ]);
    const items: RecoveryItem[] = [
      ...pending.map((id) => ({ kind: 'stale-pending', id })),
      ...orphaned.map((p) => ({ kind: 'orphan-raw', id: p.id, detail: { rawKey: p.rawKey } })),
    ];
    return items.slice(0, limit); // bounded per sweep
  }

  async recover(item: RecoveryItem, _token: CancellationToken): Promise<RecoveryResult> {
    const photo = await this.deps.photos.findById(item.id);
    if (photo === null) return { outcome: 'already-healed', detail: { reason: 'row gone' } };

    if (item.kind === 'stale-pending') {
      if (photo.status !== 'pending') return { outcome: 'already-healed' }; // processed since detection
      await this.deps.producer.enqueue(IMAGE_HARDENING_TYPE, { photoId: photo.id });
      return { outcome: 'recovered', detail: { action: 're-enqueued' } };
    }

    if (item.kind === 'orphan-raw') {
      if (photo.status !== 'ready' || photo.rawKey === null) return { outcome: 'already-healed' };
      await this.deps.objectStore.delete(photo.rawKey); // idempotent
      await this.deps.photos.clearRawKey(photo.id);
      return { outcome: 'recovered', detail: { action: 'raw-cleaned' } };
    }

    return { outcome: 'skipped' };
  }
}

/** Build the image recoverable processor over the DB adapter. */
export function createImageRecoverableProcessor(deps: {
  database: DatabaseAdapter;
  objectStore: ObjectStore;
  producer: JobProducer;
  logger: StructuredLogger;
  stalePendingMs: number;
}): ImageRecoverableProcessor {
  return new ImageRecoverableProcessor({
    photos: new PhotoRepository(deps.database),
    objectStore: deps.objectStore,
    producer: deps.producer,
    logger: deps.logger,
    stalePendingMs: deps.stalePendingMs,
  });
}
