import type { StorageKey } from '@workerv2/infra-contracts';
import { hashBytes, formatStorageKey } from '@workerv2/artifact-store';
import type { ArtifactGateway, ArtifactWriteMeta } from '@workerv2/processor-sdk';
import type { ArtifactBytesPort, ArtifactBytesMeta } from '@workerv2/image-backend';

/**
 * The store shape the host needs: BOTH artifact ports plus the synchronous content-address helpers
 * the host uses to seed sources + store the blueprint. `ContentAddressedStore` is the in-memory
 * default; a durable implementation (e.g. the production runtime's persistent store) satisfies the
 * SAME interface, so it drops in as an injected override — the only thing that changes is the host
 * wiring.
 */
export interface HostArtifactStore extends ArtifactGateway, ArtifactBytesPort {
  /** Synchronous content-addressed write (idempotent); returns the key. */
  put(content: Uint8Array): StorageKey;
  /** The content address of `content` without storing it. */
  address(content: Uint8Array): StorageKey;
  readonly size: number;
}

/**
 * The host's CONTENT-ADDRESSED artifact store — the single store every processor, the composition
 * engine, and the exporter read/write through. It implements BOTH the Processor SDK's
 * `ArtifactGateway` and the image-backend's `ArtifactBytesPort` (structurally compatible), so one
 * instance is wired everywhere and all keys are consistent. Addressing is sha256 via the artifact
 * platform (`hashBytes`), so a canonical Blueprint/Manifest/Document stored here gets a key equal
 * to its own content hash. Writes are idempotent (identical bytes → same key, no error), which is
 * what content-addressed re-production needs.
 *
 * This is the in-memory reference store the host wires by default; a durable object-storage-backed
 * store is a drop-in swap here (only the host wiring changes), which is the whole point of the
 * composition root.
 */
export class ContentAddressedStore implements HostArtifactStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async read(key: StorageKey): Promise<Uint8Array> {
    const value = this.blobs.get(key);
    if (value === undefined) throw new Error(`No artifact for key "${key}"`);
    return new Uint8Array(value);
  }

  async exists(key: StorageKey): Promise<boolean> {
    return this.blobs.has(key);
  }

  async write(
    content: Uint8Array,
    _meta?: ArtifactWriteMeta | ArtifactBytesMeta,
  ): Promise<StorageKey> {
    return this.put(content);
  }

  /** Synchronous content-addressed write (idempotent) — used for seeding + inspection. */
  put(content: Uint8Array): StorageKey {
    const key = formatStorageKey(hashBytes(content));
    if (!this.blobs.has(key)) this.blobs.set(key, new Uint8Array(content));
    return key;
  }

  /** The content address of `content` without storing it. */
  address(content: Uint8Array): StorageKey {
    return formatStorageKey(hashBytes(content));
  }

  get size(): number {
    return this.blobs.size;
  }
}
