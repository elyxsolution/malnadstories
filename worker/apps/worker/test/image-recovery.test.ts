import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import { ImageRecoverableProcessor } from '../src/processors/image/image-recovery.js';
import type {
  PhotoRow,
  PhotoStore,
  ReadyFields,
} from '../src/processors/image/photo-repository.js';
import type { ObjectStore, ObjectMetadata } from '../src/infra/storage/object-store.js';
import type { JobProducer } from '../src/infra/queue/pgboss-queue.js';
import { NONE } from '../src/recovery/cancellation.js';

class FakePhotoStore implements PhotoStore {
  readonly rows = new Map<string, PhotoRow>();
  stalePending: string[] = [];
  readyNeedingCleanup: { id: string; rawKey: string }[] = [];
  readonly clearedRaw: string[] = [];
  seed(row: PhotoRow): void {
    this.rows.set(row.id, row);
  }
  async findById(id: string): Promise<PhotoRow | null> {
    return this.rows.get(id) ?? null;
  }
  async markReady(_id: string, _f: ReadyFields): Promise<void> {}
  async markRejected(): Promise<void> {}
  async clearRawKey(id: string): Promise<void> {
    this.clearedRaw.push(id);
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, rawKey: null });
  }
  async findStalePending(): Promise<readonly string[]> {
    return this.stalePending;
  }
  async findReadyNeedingCleanup(): Promise<readonly { id: string; rawKey: string }[]> {
    return this.readyNeedingCleanup;
  }
}

class FakeObjectStore implements ObjectStore {
  readonly deleted: string[] = [];
  async read(): Promise<Uint8Array | null> {
    return null;
  }
  async write(key: string, d: Uint8Array): Promise<ObjectMetadata> {
    return { key, sizeBytes: d.byteLength };
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
}

class FakeProducer implements JobProducer {
  readonly sent: Array<{ queue: string; payload: object }> = [];
  async enqueue(queue: string, payload: object): Promise<void> {
    this.sent.push({ queue, payload });
  }
}

function build(): {
  proc: ImageRecoverableProcessor;
  photos: FakePhotoStore;
  store: FakeObjectStore;
  producer: FakeProducer;
} {
  const photos = new FakePhotoStore();
  const store = new FakeObjectStore();
  const producer = new FakeProducer();
  const proc = new ImageRecoverableProcessor({
    photos,
    objectStore: store,
    producer,
    logger: new RecordingLogger(),
    stalePendingMs: 60_000,
  });
  return { proc, photos, store, producer };
}

const pending = (id: string): PhotoRow => ({
  id,
  userId: 'u1',
  albumId: 'a1',
  rawKey: `u1/albums/a1/${id}.jpg`,
  status: 'pending',
  originalFilename: 'x.jpg',
});

describe('ImageRecoverableProcessor', () => {
  it('detects stale pending + ready-needing-cleanup as typed items', async () => {
    const { proc, photos } = build();
    photos.stalePending = ['p1'];
    photos.readyNeedingCleanup = [{ id: 'p2', rawKey: 'u1/albums/a1/p2.jpg' }];
    const items = await proc.detectStale(100, NONE);
    expect(items).toEqual([
      { kind: 'stale-pending', id: 'p1' },
      { kind: 'orphan-raw', id: 'p2', detail: { rawKey: 'u1/albums/a1/p2.jpg' } },
    ]);
  });

  it('re-enqueues a still-pending photo (recovered)', async () => {
    const { proc, photos, producer } = build();
    photos.seed(pending('p1'));
    const result = await proc.recover({ kind: 'stale-pending', id: 'p1' }, NONE);
    expect(result.outcome).toBe('recovered');
    expect(producer.sent).toEqual([{ queue: 'image-hardening', payload: { photoId: 'p1' } }]);
  });

  it('treats an already-processed photo as already-healed (idempotent, race-safe)', async () => {
    const { proc, photos, producer } = build();
    photos.seed({ ...pending('p1'), status: 'ready' }); // processed since detection
    const result = await proc.recover({ kind: 'stale-pending', id: 'p1' }, NONE);
    expect(result.outcome).toBe('already-healed');
    expect(producer.sent).toEqual([]);
  });

  it('reconciles an orphaned raw (delete + clear the key) — the logic MOVED here from the processor', async () => {
    const { proc, photos, store } = build();
    photos.seed({ ...pending('p2'), status: 'ready' }); // ready but rawKey still set
    const result = await proc.recover({ kind: 'orphan-raw', id: 'p2' }, NONE);
    expect(result.outcome).toBe('recovered');
    expect(store.deleted).toEqual(['u1/albums/a1/p2.jpg']);
    expect(photos.clearedRaw).toEqual(['p2']);
  });

  it('is a no-op when the orphan was already cleaned', async () => {
    const { proc, photos, store } = build();
    photos.seed({ ...pending('p2'), status: 'ready', rawKey: null });
    const result = await proc.recover({ kind: 'orphan-raw', id: 'p2' }, NONE);
    expect(result.outcome).toBe('already-healed');
    expect(store.deleted).toEqual([]);
  });
});
