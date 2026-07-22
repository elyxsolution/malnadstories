import { describe, expect, it } from 'vitest';
import { StorageError } from '@workerv2/infra-contracts';
import type { ArtifactStore, StorageKey, StoredArtifact } from '@workerv2/infra-contracts';

// In-memory TEST DOUBLE enforcing the write-once contract (INV-2 / INV-10).
class InMemoryArtifactStore implements ArtifactStore {
  private readonly store = new Map<string, { data: Uint8Array; contentType?: string }>();

  async put(key: StorageKey, data: Uint8Array, contentType?: string): Promise<StoredArtifact> {
    if (this.store.has(key)) {
      throw new StorageError(`Refusing to overwrite immutable artifact: ${key}`, {
        context: { key },
      });
    }
    this.store.set(key, contentType === undefined ? { data } : { data, contentType });
    return contentType === undefined
      ? { key, sizeBytes: data.byteLength }
      : { key, sizeBytes: data.byteLength, contentType };
  }
  async get(key: StorageKey): Promise<Uint8Array | null> {
    return this.store.get(key)?.data ?? null;
  }
  async exists(key: StorageKey): Promise<boolean> {
    return this.store.has(key);
  }
  async head(key: StorageKey): Promise<StoredArtifact | null> {
    const entry = this.store.get(key);
    if (entry === undefined) return null;
    return entry.contentType === undefined
      ? { key, sizeBytes: entry.data.byteLength }
      : { key, sizeBytes: entry.data.byteLength, contentType: entry.contentType };
  }
}

const key = 'sha256:abc123' as unknown as StorageKey;
const data = new Uint8Array([1, 2, 3]);

describe('ArtifactStore contract (write-once, content-addressed)', () => {
  it('stores and reads back by key', async () => {
    const store: ArtifactStore = new InMemoryArtifactStore();
    expect(await store.exists(key)).toBe(false);
    const meta = await store.put(key, data, 'application/pdf');
    expect(meta).toStrictEqual({ key, sizeBytes: 3, contentType: 'application/pdf' });
    expect(await store.get(key)).toStrictEqual(data);
    expect(await store.head(key)).toStrictEqual(meta);
  });

  it('refuses to overwrite an existing key (immutability)', async () => {
    const store: ArtifactStore = new InMemoryArtifactStore();
    await store.put(key, data);
    await expect(store.put(key, new Uint8Array([9]))).rejects.toThrowError(/Refusing to overwrite/);
  });

  it('returns null for an absent key', async () => {
    const store: ArtifactStore = new InMemoryArtifactStore();
    expect(await store.get(key)).toBeNull();
    expect(await store.head(key)).toBeNull();
  });
});
