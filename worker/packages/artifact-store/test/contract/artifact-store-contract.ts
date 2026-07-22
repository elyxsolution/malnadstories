import { describe, expect, it } from 'vitest';
import { IntegrityError, StorageError } from '@workerv2/infra-contracts';
import type { StreamingArtifactStore } from '@workerv2/infra-contracts';
import { Sha256ContentAddressing } from '@workerv2/artifact-store';
import { streamOf } from '../helpers.js';

/**
 * REUSABLE CONTRACT SUITE for any `StreamingArtifactStore` implementation. A future durable
 * backend (e.g. object storage) imports this and passes its own factory — the guarantees
 * (deterministic content addressing, write-once immutability, integrity at write, streaming
 * equivalence, absent-key behavior) must hold for EVERY backend, which is what makes artifact
 * identity storage-backend independent.
 */
export function runArtifactStoreContract(
  name: string,
  makeStore: () => StreamingArtifactStore,
): void {
  const addressing = new Sha256ContentAddressing();
  const data = new Uint8Array([1, 2, 3, 4]);
  const key = addressing.address(data);

  describe(`${name} — ArtifactStore contract`, () => {
    it('stores and reads back by content-derived key', async () => {
      const store = makeStore();
      expect(await store.exists(key)).toBe(false);
      const meta = await store.put(key, data, 'application/octet-stream');
      expect(meta).toStrictEqual({
        key,
        sizeBytes: 4,
        contentType: 'application/octet-stream',
      });
      expect(await store.get(key)).toStrictEqual(data);
      expect(await store.exists(key)).toBe(true);
      expect(await store.head(key)).toStrictEqual(meta);
    });

    it('refuses to overwrite an existing key (write-once, INV-2)', async () => {
      const store = makeStore();
      await store.put(key, data);
      await expect(store.put(key, data)).rejects.toThrowError(StorageError);
    });

    it('refuses content stored under a key it does not hash to (integrity at write)', async () => {
      const store = makeStore();
      await expect(store.put(key, new Uint8Array([9, 9]))).rejects.toThrowError(IntegrityError);
    });

    it('returns null for an absent key', async () => {
      const store = makeStore();
      expect(await store.get(key)).toBeNull();
      expect(await store.head(key)).toBeNull();
      expect(await store.getStream(key)).toBeNull();
    });

    it('streams in and out with the same identity as a whole-buffer write', async () => {
      const store = makeStore();
      const meta = await store.putStream(streamOf(new Uint8Array([1, 2]), new Uint8Array([3, 4])));
      expect(meta.key).toBe(key); // chunking never changes identity
      expect(meta.sizeBytes).toBe(4);

      const stream = await store.getStream(key);
      expect(stream).not.toBeNull();
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream ?? []) chunks.push(chunk);
      const total = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        total.set(chunk, offset);
        offset += chunk.byteLength;
      }
      expect(total).toStrictEqual(data);
    });

    it('putStream of already-stored content is an idempotent no-op (INV-7)', async () => {
      const store = makeStore();
      await store.put(key, data);
      const meta = await store.putStream(streamOf(data));
      expect(meta.key).toBe(key);
      expect(await store.get(key)).toStrictEqual(data);
    });
  });
}
