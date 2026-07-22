import type { ArtifactStore, StorageKey, StoredArtifact } from './artifact-store.js';

/**
 * A byte stream — the platform-neutral streaming primitive (no Node/Web coupling; an
 * `AsyncIterable` works in both). Used to read/write large artifacts without materializing the
 * whole payload up front at the call site.
 */
export type ArtifactByteStream = AsyncIterable<Uint8Array>;

/**
 * A write-once, content-addressed store that ALSO supports streaming I/O. `putStream` derives the
 * key from the streamed content (content-addressing), so the caller does not supply one. `getStream`
 * yields the stored bytes or resolves to `null` when the key is absent. Streaming does not weaken any
 * guarantee — writes are still write-once (INV-2) and content-addressed (INV-10).
 */
export interface StreamingArtifactStore extends ArtifactStore {
  putStream(stream: ArtifactByteStream, contentType?: string): Promise<StoredArtifact>;
  getStream(key: StorageKey): Promise<ArtifactByteStream | null>;
}
