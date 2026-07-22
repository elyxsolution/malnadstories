import type { Brand } from '@workerv2/contracts';

/**
 * A content/identity-addressed storage key (INV-10: no mutable keys). Concrete addressing (the
 * hashing scheme) is supplied by an implementation of `ContentAddressing` — this package defines
 * only the contract.
 */
export type StorageKey = Brand<string, 'StorageKey'>;

/** Computes a stable storage key from content. Implementation (hashing) is deferred. */
export interface ContentAddressing {
  address(data: Uint8Array): StorageKey;
}

/** Metadata describing a stored artifact. */
export interface StoredArtifact {
  readonly key: StorageKey;
  readonly sizeBytes: number;
  readonly contentType?: string;
}

/**
 * A WRITE-ONCE, content-addressed artifact store (INV-2: artifacts immutable; INV-10: no mutable
 * keys). `put` must reject an attempt to overwrite an existing key. Reads are by key. This is a
 * CONTRACT — no storage backend is implemented here.
 */
export interface ArtifactStore {
  /** Store data under `key`. Must fail (StorageError) if the key already exists. */
  put(key: StorageKey, data: Uint8Array, contentType?: string): Promise<StoredArtifact>;
  get(key: StorageKey): Promise<Uint8Array | null>;
  exists(key: StorageKey): Promise<boolean>;
  head(key: StorageKey): Promise<StoredArtifact | null>;
}

/** The top-level storage seam a concrete backend (e.g. object storage) implements. */
export interface StorageAdapter {
  readonly artifacts: ArtifactStore;
  readonly addressing: ContentAddressing;
}
