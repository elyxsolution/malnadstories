import { describe, expect, it } from 'vitest';
import {
  ContentAddressedArtifactStore,
  InMemoryBlobStore,
  Sha256ContentAddressing,
} from '@workerv2/artifact-store';
import { IntegrityError } from '@workerv2/infra-contracts';
import { runArtifactStoreContract } from './contract/artifact-store-contract.js';
import { bytes } from './helpers.js';

// The reusable contract suite — a future durable backend runs exactly this against its own store.
runArtifactStoreContract(
  'ContentAddressedArtifactStore (InMemoryBlobStore)',
  () => new ContentAddressedArtifactStore(new InMemoryBlobStore()),
);

const addressing = new Sha256ContentAddressing();

describe('ContentAddressedArtifactStore — beyond the base contract', () => {
  it('putContent derives the key and is idempotent for identical content (INV-7)', async () => {
    const store = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const first = await store.putContent(bytes(5, 6, 7), 'image/jpeg');
    const again = await store.putContent(bytes(5, 6, 7), 'image/jpeg');
    expect(first.key).toBe(addressing.address(bytes(5, 6, 7)));
    expect(again).toStrictEqual(first);
    expect(await store.get(first.key)).toStrictEqual(bytes(5, 6, 7));
  });

  it('artifact identity is independent of the storage backend', async () => {
    // Same content through two SEPARATE backends → the same identity.
    const storeA = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const storeB = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const a = await storeA.putContent(bytes(9, 9, 9));
    const b = await storeB.putContent(bytes(9, 9, 9));
    expect(a.key).toBe(b.key);
  });

  it('stored bytes are isolated from caller mutation (immutability at the byte level)', async () => {
    const store = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const input = bytes(1, 1, 1);
    const meta = await store.putContent(input);
    input[0] = 99; // mutating the caller's buffer must not alter the stored artifact
    expect(await store.get(meta.key)).toStrictEqual(bytes(1, 1, 1));

    const read = await store.get(meta.key);
    if (read !== null) read[0] = 42; // mutating a read buffer must not alter the stored artifact
    expect(await store.get(meta.key)).toStrictEqual(bytes(1, 1, 1));
  });

  it('getVerified returns bytes that still match their address', async () => {
    const store = new ContentAddressedArtifactStore(new InMemoryBlobStore());
    const meta = await store.putContent(bytes(3, 3, 3));
    expect(await store.getVerified(meta.key)).toStrictEqual(bytes(3, 3, 3));
    expect(await store.getVerified(addressing.address(bytes(0)))).toBeNull();
  });

  it('getVerified surfaces backend corruption as IntegrityError', async () => {
    const blobs = new InMemoryBlobStore();
    const store = new ContentAddressedArtifactStore(blobs);
    const meta = await store.putContent(bytes(4, 4, 4));
    // Corrupt the backend BEHIND the store (simulates bit rot / a faulty backend).
    await blobs.put(meta.key, { data: bytes(6, 6, 6) });
    await expect(store.getVerified(meta.key)).rejects.toThrowError(IntegrityError);
  });
});
