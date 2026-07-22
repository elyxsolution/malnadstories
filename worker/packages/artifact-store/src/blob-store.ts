/**
 * The low-level STORAGE PROVIDER primitive — a plain, domain-ignorant blob key/value store,
 * modelling private object storage (put/get bytes by key). This is the seam that keeps storage
 * REPLACEABLE (WBS 5.1.1): the reference engine is in-memory; a durable backend (e.g. R2/S3)
 * implements the same async interface and nothing above it changes. It is deliberately generic —
 * it enforces neither content-addressing nor write-once (those are the `ArtifactStore`'s job),
 * only raw byte storage.
 */
export interface StoredBlob {
  readonly data: Uint8Array;
  readonly contentType?: string;
}

export interface BlobStore {
  put(key: string, blob: StoredBlob): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  has(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** All stored keys (order-stable). */
  keys(): Promise<string[]>;
}

/** In-memory {@link BlobStore} backing the reference artifact store. */
export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, StoredBlob>();

  async put(key: string, blob: StoredBlob): Promise<void> {
    // Defensive copy so a later mutation of the caller's buffer cannot alter stored bytes.
    const copy: StoredBlob =
      blob.contentType === undefined
        ? { data: Uint8Array.from(blob.data) }
        : { data: Uint8Array.from(blob.data), contentType: blob.contentType };
    this.blobs.set(key, copy);
  }

  async get(key: string): Promise<StoredBlob | null> {
    const blob = this.blobs.get(key);
    if (blob === undefined) return null;
    // Return a copy so callers cannot mutate stored bytes (immutability at the byte level).
    return blob.contentType === undefined
      ? { data: Uint8Array.from(blob.data) }
      : { data: Uint8Array.from(blob.data), contentType: blob.contentType };
  }

  async has(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.blobs.keys()];
  }
}
