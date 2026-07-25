import { describe, it, expect, beforeEach } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import type { Job } from '../src/job.js';
import type {
  ObjectStore,
  ObjectMetadata,
  WriteOptions,
} from '../src/infra/storage/object-store.js';
import { ImageProcessor, IMAGE_HARDENING_TYPE } from '../src/processors/image/image-processor.js';
import { defaultImageStages } from '../src/processors/image/stages.js';
import type { ImageCodec, Raster } from '../src/processors/image/image-codec.js';
import type {
  PhotoRow,
  PhotoStore,
  ReadyFields,
} from '../src/processors/image/photo-repository.js';

// --- Fakes ------------------------------------------------------------------------------------

/** In-memory object store; records writes/deletes; can simulate a missing object. */
class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  readonly writes: string[] = [];

  put(key: string, bytes: Uint8Array): void {
    this.objects.set(key, bytes);
  }
  async read(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async write(key: string, data: Uint8Array, _options?: WriteOptions): Promise<ObjectMetadata> {
    this.objects.set(key, data);
    this.writes.push(key);
    return { key, sizeBytes: data.byteLength };
  }
  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
}

/** In-memory photo store. */
class FakePhotoStore implements PhotoStore {
  readonly rows = new Map<string, PhotoRow>();
  readonly ready = new Map<string, ReadyFields>();

  seed(row: PhotoRow): void {
    this.rows.set(row.id, row);
  }
  async findById(photoId: string): Promise<PhotoRow | null> {
    return this.rows.get(photoId) ?? null;
  }
  async markReady(photoId: string, fields: ReadyFields): Promise<void> {
    const row = this.rows.get(photoId);
    if (row) this.rows.set(photoId, { ...row, status: 'ready' });
    this.ready.set(photoId, fields);
  }
  async markRejected(photoId: string): Promise<void> {
    const row = this.rows.get(photoId);
    if (row) this.rows.set(photoId, { ...row, status: 'rejected' });
  }
  async clearRawKey(photoId: string): Promise<void> {
    const row = this.rows.get(photoId);
    if (row) this.rows.set(photoId, { ...row, rawKey: null });
  }
  async findStalePending(): Promise<readonly string[]> {
    return [];
  }
  async findReadyNeedingCleanup(): Promise<readonly { id: string; rawKey: string }[]> {
    return [];
  }
}

/** Deterministic fake codec — no sharp. Records calls; configurable to simulate failures. */
class FakeCodec implements ImageCodec {
  mime: string | null = 'image/jpeg';
  probeError = false;
  decodeError = false;
  dims = { width: 1000, height: 800 };
  heicCalled = 0;
  takenAt: Date | null = new Date('2024-05-01T10:00:00.000Z');

  async detectMime(): Promise<string | null> {
    return this.mime;
  }
  async heicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
    this.heicCalled += 1;
    return bytes;
  }
  async readCaptureDate(): Promise<Date | null> {
    return this.takenAt;
  }
  async probeDimensions(): Promise<{ width: number; height: number }> {
    if (this.probeError) throw new Error('probe failed');
    return this.dims;
  }
  async decodeOriented(): Promise<Raster> {
    if (this.decodeError) throw new Error('decode failed');
    return {
      data: new Uint8Array([0, 0, 0]),
      width: this.dims.width,
      height: this.dims.height,
      channels: 3,
    };
  }
  async encodeJpeg(): Promise<Uint8Array> {
    return new Uint8Array([0xff, 0xd8, 0x01]); // master
  }
  async encodeThumbnail(): Promise<Uint8Array> {
    return new Uint8Array([0xff, 0xd8, 0x02]); // thumb
  }
}

const PHOTO: PhotoRow = {
  id: 'photo-1',
  userId: 'user-1',
  albumId: 'album-1',
  rawKey: 'user-1/albums/album-1/abc.jpg',
  status: 'pending',
  originalFilename: 'trip.jpg',
};

function makeJob(photoId = 'photo-1'): Job<{ photoId: string }> {
  return {
    id: 'job-1',
    type: IMAGE_HARDENING_TYPE,
    payload: { photoId },
    metadata: { correlationId: 'req-1', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function build(overrides?: { codec?: FakeCodec }): {
  processor: ImageProcessor;
  store: FakeObjectStore;
  photos: FakePhotoStore;
  codec: FakeCodec;
  logger: RecordingLogger;
} {
  const store = new FakeObjectStore();
  const photos = new FakePhotoStore();
  const codec = overrides?.codec ?? new FakeCodec();
  const logger = new RecordingLogger();
  const processor = new ImageProcessor({
    objectStore: store,
    codec,
    photos,
    logger,
    stages: defaultImageStages(),
  });
  return { processor, store, photos, codec, logger };
}

// --- Tests ------------------------------------------------------------------------------------

describe('image pipeline — happy path', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.photos.seed(PHOTO);
    ctx.store.put(PHOTO.rawKey!, new Uint8Array([1, 2, 3, 4]));
  });

  it('takes a pending photo to READY: uploads derivatives, writes columns, deletes raw', async () => {
    await ctx.processor.process(makeJob());

    // derivatives uploaded under deterministic keys
    expect(ctx.store.writes).toEqual([
      'user-1/albums/album-1/abc_full.jpg',
      'user-1/albums/album-1/abc_thumb.jpg',
    ]);
    // photo row finalized
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('ready');
    expect(ctx.photos.ready.get('photo-1')).toEqual({
      sanitizedKey: 'user-1/albums/album-1/abc_full.jpg',
      thumbKey: 'user-1/albums/album-1/abc_thumb.jpg',
      width: 1000,
      height: 800,
      takenAt: new Date('2024-05-01T10:00:00.000Z'),
    });
    // raw deleted + key cleared
    expect(ctx.store.deleted).toEqual(['user-1/albums/album-1/abc.jpg']);
    expect(ctx.photos.rows.get('photo-1')?.rawKey).toBeNull();
  });

  it('extracts EXIF capture date, or null when absent', async () => {
    ctx.codec.takenAt = null;
    await ctx.processor.process(makeJob());
    expect(ctx.photos.ready.get('photo-1')?.takenAt).toBeNull();
  });

  it('routes HEIC input through the transcode branch', async () => {
    ctx.codec.mime = 'image/heic';
    await ctx.processor.process(makeJob());
    expect(ctx.codec.heicCalled).toBe(1);
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('ready');
  });
});

describe('image pipeline — idempotency & recovery', () => {
  it('is a no-op when the photo is already READY with no raw key (duplicate delivery)', async () => {
    const ctx = build();
    ctx.photos.seed({ ...PHOTO, status: 'ready', rawKey: null });
    await ctx.processor.process(makeJob());
    expect(ctx.store.writes).toEqual([]);
    expect(ctx.store.deleted).toEqual([]);
  });

  it('is a no-op for a READY-but-raw-still-present photo (reconcile is now the Coordinator’s job)', async () => {
    // The processor no longer reconciles deferred raw cleanup — it just processes. A crash between
    // mark-ready and raw-delete is healed by the image RecoverableProcessor (see image-recovery.test.ts).
    const ctx = build();
    ctx.photos.seed({ ...PHOTO, status: 'ready' }); // rawKey still set
    ctx.store.put(PHOTO.rawKey!, new Uint8Array([1]));
    await ctx.processor.process(makeJob());
    expect(ctx.store.writes).toEqual([]);
    expect(ctx.store.deleted).toEqual([]); // processor does NOT clean the raw
  });

  it('re-running a completed job overwrites the same keys (no duplicate objects)', async () => {
    const ctx = build();
    ctx.photos.seed(PHOTO);
    ctx.store.put(PHOTO.rawKey!, new Uint8Array([1, 2, 3]));
    await ctx.processor.process(makeJob());
    const objectCountAfterFirst = ctx.store.objects.size;

    // simulate a redelivery of the SAME work against a fresh pending row (deterministic keys)
    ctx.photos.seed(PHOTO);
    ctx.store.put(PHOTO.rawKey!, new Uint8Array([1, 2, 3]));
    await ctx.processor.process(makeJob());

    // still exactly the two derivative keys — overwrite, not duplicate
    expect([...ctx.store.objects.keys()].sort()).toEqual([
      'user-1/albums/album-1/abc_full.jpg',
      'user-1/albums/album-1/abc_thumb.jpg',
    ]);
    expect(ctx.store.objects.size).toBe(objectCountAfterFirst);
  });

  it('skips a photo already marked rejected (terminal)', async () => {
    const ctx = build();
    ctx.photos.seed({ ...PHOTO, status: 'rejected' });
    await ctx.processor.process(makeJob());
    expect(ctx.store.writes).toEqual([]);
  });
});

describe('image pipeline — rejection (permanent → ack, no retry)', () => {
  function pendingCtx(mutate?: (c: FakeCodec) => void): ReturnType<typeof build> {
    const ctx = build();
    ctx.photos.seed(PHOTO);
    ctx.store.put(PHOTO.rawKey!, new Uint8Array([1, 2, 3, 4]));
    if (mutate) mutate(ctx.codec);
    return ctx;
  }

  it('rejects an unsupported / spoofed type', async () => {
    const ctx = pendingCtx((c) => (c.mime = 'application/pdf'));
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
    expect(ctx.store.writes).toEqual([]);
  });

  it('rejects an unrecognized (corrupt) file', async () => {
    const ctx = pendingCtx((c) => (c.mime = null));
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
  });

  it('rejects a decompression bomb (dimensions too large)', async () => {
    const ctx = pendingCtx((c) => (c.dims = { width: 40000, height: 40000 }));
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
  });

  it('rejects an undecodable image', async () => {
    const ctx = pendingCtx((c) => (c.probeError = true));
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
  });

  it('rejects a photo whose raw key is missing entirely', async () => {
    const ctx = build();
    ctx.photos.seed({ ...PHOTO, rawKey: null });
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
  });

  it('rejects a key outside the owner/album prefix (defense in depth)', async () => {
    const ctx = build();
    ctx.photos.seed({ ...PHOTO, rawKey: 'other-user/albums/x/abc.jpg' });
    await ctx.processor.process(makeJob());
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('rejected');
  });
});

describe('image pipeline — transient failures (throw → retry)', () => {
  it('throws when the raw object is not readable (retryable)', async () => {
    const ctx = build();
    ctx.photos.seed(PHOTO); // row present, but no object in the store
    await expect(ctx.processor.process(makeJob())).rejects.toThrow(/raw object not readable/);
    expect(ctx.photos.rows.get('photo-1')?.status).toBe('pending'); // NOT rejected — retry keeps it pending
  });
});

/**
 * Phase I-4: the processor no longer hand-logs its terminal outcomes — it emits `processor.rejected`
 * / `processor.skipped` events, and the default `LoggingEventSink` renders them as records whose
 * `message` IS the event type. The observable behaviour is asserted through that.
 */
function outcome(ctx: ReturnType<typeof build>, type: string): Record<string, unknown> | undefined {
  return ctx.logger.records.find((r) => r.message === type)?.detail as
    Record<string, unknown> | undefined;
}

describe('image pipeline — guard rails', () => {
  it('drops a poison payload without throwing (ack) and never touches storage', async () => {
    const ctx = build();
    await ctx.processor.process({ ...makeJob(), payload: {} as { photoId: string } });
    expect(ctx.store.writes).toEqual([]);
    expect(outcome(ctx, 'processor.rejected')).toMatchObject({ reason: 'bad_payload' });
  });

  it('is a no-op when the photo row has vanished', async () => {
    const ctx = build(); // nothing seeded
    await ctx.processor.process(makeJob());
    expect(ctx.store.writes).toEqual([]);
    expect(outcome(ctx, 'processor.skipped')).toMatchObject({ reason: 'photo_missing' });
  });
});
