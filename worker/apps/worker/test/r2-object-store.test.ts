import { describe, it, expect } from 'vitest';
import { R2ObjectStore } from '../src/infra/storage/r2-object-store.js';
import type { S3Like } from '../src/infra/storage/r2-object-store.js';

/** A fake S3 client that routes real AWS command instances by their class name against an in-memory bucket. */
class FakeS3 implements S3Like {
  bucketReachable = true;
  private readonly objects = new Map<string, { body: Uint8Array; contentType?: string }>();

  async send(command: unknown): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = (command as { input: Record<string, unknown> }).input;
    const key = input['Key'] as string;

    switch (name) {
      case 'PutObjectCommand': {
        this.objects.set(key, {
          body: input['Body'] as Uint8Array,
          contentType: input['ContentType'] as string | undefined,
        });
        return { ETag: '"abc123"' };
      }
      case 'GetObjectCommand': {
        const obj = this.objects.get(key);
        if (obj === undefined) throw notFound();
        return { Body: { transformToByteArray: async (): Promise<Uint8Array> => obj.body } };
      }
      case 'HeadObjectCommand': {
        const obj = this.objects.get(key);
        if (obj === undefined) throw notFound();
        return {
          ContentLength: obj.body.byteLength,
          ContentType: obj.contentType,
          ETag: '"abc123"',
          LastModified: new Date('2026-01-02T03:04:05.000Z'),
        };
      }
      case 'DeleteObjectCommand': {
        this.objects.delete(key);
        return {};
      }
      case 'HeadBucketCommand': {
        if (!this.bucketReachable) throw new Error('bucket unreachable');
        return {};
      }
      default:
        throw new Error(`unexpected command: ${name}`);
    }
  }
}

function notFound(): Error {
  const err = new Error('not found') as Error & { name: string };
  err.name = 'NotFound';
  return err;
}

function store(fake: FakeS3 = new FakeS3()): { fake: FakeS3; r2: R2ObjectStore } {
  return { fake, r2: new R2ObjectStore(fake, 'malnad-bucket') };
}

describe('R2ObjectStore', () => {
  it('writes then reads bytes round-trip', async () => {
    const { r2 } = store();
    const data = new Uint8Array([1, 2, 3, 4]);
    const meta = await r2.write('u1/albums/a1/x.jpg', data, { contentType: 'image/jpeg' });

    expect(meta).toEqual({
      key: 'u1/albums/a1/x.jpg',
      sizeBytes: 4,
      contentType: 'image/jpeg',
      etag: '"abc123"',
    });
    expect(await r2.read('u1/albums/a1/x.jpg')).toEqual(data);
  });

  it('read returns null for a missing key (absence is not an error)', async () => {
    const { r2 } = store();
    expect(await r2.read('nope')).toBeNull();
  });

  it('head returns metadata, or null when absent', async () => {
    const { r2 } = store();
    await r2.write('k', new Uint8Array([9, 9]), { contentType: 'application/pdf' });

    expect(await r2.head('k')).toEqual({
      key: 'k',
      sizeBytes: 2,
      contentType: 'application/pdf',
      etag: '"abc123"',
      lastModified: '2026-01-02T03:04:05.000Z',
    });
    expect(await r2.head('missing')).toBeNull();
  });

  it('exists reflects presence', async () => {
    const { r2 } = store();
    expect(await r2.exists('k')).toBe(false);
    await r2.write('k', new Uint8Array([1]));
    expect(await r2.exists('k')).toBe(true);
  });

  it('delete removes the object and is idempotent', async () => {
    const { r2 } = store();
    await r2.write('k', new Uint8Array([1]));
    await r2.delete('k');
    expect(await r2.exists('k')).toBe(false);
    await expect(r2.delete('k')).resolves.toBeUndefined(); // no throw on missing
  });

  it('healthCheck reports bucket reachability', async () => {
    const { fake, r2 } = store();
    expect(await r2.healthCheck()).toBe('healthy');
    fake.bucketReachable = false;
    expect(await r2.healthCheck()).toBe('unhealthy');
  });
});
