import { createHash } from 'node:crypto';
import { StorageError, IntegrityError } from '@workerv2/infra-contracts';
import type {
  ArtifactByteStream,
  StorageKey,
  StoredArtifact,
  StreamingArtifactStore,
} from '@workerv2/infra-contracts';
import type { BlobStore } from './blob-store.js';
import { CONTENT_HASH_ALGORITHM, Sha256ContentAddressing } from './content-addressing.js';

/** Chunk size used when streaming stored bytes back out. */
const READ_CHUNK_BYTES = 64 * 1024;

function toStoredArtifact(
  key: StorageKey,
  sizeBytes: number,
  contentType?: string,
): StoredArtifact {
  return contentType === undefined ? { key, sizeBytes } : { key, sizeBytes, contentType };
}

/**
 * The concrete CONTENT-ADDRESSED, WRITE-ONCE artifact store (INV-2 / INV-10) over a replaceable
 * `BlobStore` backend. Guarantees, independent of the backend:
 *
 * - **Content addressing is deterministic** — a key is always `sha256:<digest-of-the-bytes>`;
 *   `put` REJECTS a key that does not match its content (`IntegrityError`), so a mis-addressed
 *   or corrupted write can never enter the store.
 * - **Write-once** — `put` refuses to overwrite an existing key (`StorageError`). The
 *   content-derived entry points (`putContent`/`putStream`) are idempotent instead: re-storing
 *   byte-identical content is a no-op returning the existing artifact (same bytes ⇒ same
 *   identity ⇒ nothing is overwritten).
 * - **Identity is backend-independent** — the key derives from the bytes alone; swapping the
 *   `BlobStore` (in-memory today, durable object storage later) never changes any identity.
 *
 * No business logic lives here — only byte storage, addressing, and the immutability guards.
 */
export class ContentAddressedArtifactStore implements StreamingArtifactStore {
  private readonly addressing = new Sha256ContentAddressing();

  constructor(private readonly blobs: BlobStore) {}

  /** Store bytes under an explicit, content-derived key. Rejects mismatched keys + overwrites. */
  async put(key: StorageKey, data: Uint8Array, contentType?: string): Promise<StoredArtifact> {
    const derived = this.addressing.address(data);
    if (derived !== key) {
      throw new IntegrityError('Refusing to store content under a key it does not hash to', {
        context: { key, derived, sizeBytes: data.byteLength },
      });
    }
    if (await this.blobs.has(key)) {
      throw new StorageError(`Refusing to overwrite immutable artifact: ${key}`, {
        context: { key },
      });
    }
    await this.blobs.put(key, contentType === undefined ? { data } : { data, contentType });
    return toStoredArtifact(key, data.byteLength, contentType);
  }

  /**
   * Store content by its own address (the natural content-addressed write). Idempotent: if the
   * identical content is already stored, returns the existing artifact without writing (INV-7).
   */
  async putContent(data: Uint8Array, contentType?: string): Promise<StoredArtifact> {
    const key = this.addressing.address(data);
    const existing = await this.head(key);
    if (existing !== null) return existing;
    await this.blobs.put(key, contentType === undefined ? { data } : { data, contentType });
    return toStoredArtifact(key, data.byteLength, contentType);
  }

  /** Streaming write: hash incrementally, derive the key, store. Idempotent like `putContent`. */
  async putStream(stream: ArtifactByteStream, contentType?: string): Promise<StoredArtifact> {
    const hash = createHash(CONTENT_HASH_ALGORITHM);
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    for await (const chunk of stream) {
      hash.update(chunk);
      chunks.push(Uint8Array.from(chunk));
      sizeBytes += chunk.byteLength;
    }
    const key = `${CONTENT_HASH_ALGORITHM}:${hash.digest('hex')}` as StorageKey;
    const existing = await this.head(key);
    if (existing !== null) return existing;

    const data = new Uint8Array(sizeBytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await this.blobs.put(key, contentType === undefined ? { data } : { data, contentType });
    return toStoredArtifact(key, sizeBytes, contentType);
  }

  async get(key: StorageKey): Promise<Uint8Array | null> {
    const blob = await this.blobs.get(key);
    return blob?.data ?? null;
  }

  /** Read + verify: returns the bytes only if they still hash to `key` (corruption guard). */
  async getVerified(key: StorageKey): Promise<Uint8Array | null> {
    const data = await this.get(key);
    if (data === null) return null;
    const actual = this.addressing.address(data);
    if (actual !== key) {
      throw new IntegrityError('Stored content no longer matches its content address', {
        context: { key, actual, sizeBytes: data.byteLength },
      });
    }
    return data;
  }

  /** Streaming read of the stored bytes, or `null` when absent. */
  async getStream(key: StorageKey): Promise<ArtifactByteStream | null> {
    const data = await this.get(key);
    if (data === null) return null;
    return (async function* stream(): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < data.byteLength; offset += READ_CHUNK_BYTES) {
        yield data.subarray(offset, Math.min(offset + READ_CHUNK_BYTES, data.byteLength));
      }
    })();
  }

  async exists(key: StorageKey): Promise<boolean> {
    return this.blobs.has(key);
  }

  async head(key: StorageKey): Promise<StoredArtifact | null> {
    const blob = await this.blobs.get(key);
    if (blob === null) return null;
    return toStoredArtifact(key, blob.data.byteLength, blob.contentType);
  }
}
