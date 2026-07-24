import type { StorageKey } from '@workerv2/infra-contracts';
import { hashBytes, formatStorageKey, CONTENT_HASH_ALGORITHM } from '@workerv2/artifact-store';
import type { HostArtifactStore } from '@workerv2/worker-host';
import type { StorageBackend } from './backend.js';

/**
 * The PERSISTENT ARTIFACT STORE — a durable, content-addressed store over a `StorageBackend`. It is
 * a drop-in for the host's in-memory `ContentAddressedStore`: SAME sha256 addressing (via the
 * artifact platform), SAME idempotent write-once semantics, SAME `HostArtifactStore` shape — so an
 * artifact's identity is identical whether stored in memory or durably. Content-addressed keys make
 * restart recovery trivially safe: a re-run re-produces the identical key and reuses the existing
 * bytes.
 */
const ARTIFACT_PREFIX = `${CONTENT_HASH_ALGORITHM}:`;

export class PersistentArtifactStore implements HostArtifactStore {
  constructor(private readonly backend: StorageBackend) {}

  async read(key: StorageKey): Promise<Uint8Array> {
    const bytes = this.backend.get(key);
    if (bytes === undefined) throw new Error(`No artifact for key "${key}"`);
    return bytes;
  }

  async exists(key: StorageKey): Promise<boolean> {
    return this.backend.has(key);
  }

  async write(content: Uint8Array): Promise<StorageKey> {
    return this.put(content);
  }

  put(content: Uint8Array): StorageKey {
    const key = this.address(content);
    if (!this.backend.has(key)) this.backend.put(key, content);
    return key;
  }

  address(content: Uint8Array): StorageKey {
    return formatStorageKey(hashBytes(content));
  }

  get size(): number {
    return this.backend.keys().filter((k) => k.startsWith(ARTIFACT_PREFIX)).length;
  }
}
