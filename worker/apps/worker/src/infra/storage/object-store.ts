/**
 * OBJECT STORE CONTRACT — an async, MUTABLE-KEY blob store for the application's own R2 objects
 * (`{user}/albums/{album}/…`, `preview.pdf`, sanitized/thumb derivatives).
 *
 * This is deliberately DISTINCT from the runtime's write-once, content-addressed `ArtifactStore`
 * (`@workerv2/infra-contracts`): that seam models the engine's immutable internal artifacts
 * (`sha256:…`, `put` rejects overwrite, no delete). The application's storage is the opposite — human
 * meaningful keys the app already owns, overwritten on regenerate and deleted on cleanup. Conflating
 * the two would corrupt one of the models, so the integration layer keeps its own contract. It touches
 * the SAME R2 bucket the app uses and NEVER changes the key layout.
 */

/** Metadata describing a stored object (returned by `head`, and by `write` for the object just stored). */
export interface ObjectMetadata {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType?: string;
  readonly etag?: string;
  /** ISO-8601 last-modified time, when the backend reports one. */
  readonly lastModified?: string;
}

export type ObjectStoreHealth = 'healthy' | 'unhealthy';

/** Options for a write. */
export interface WriteOptions {
  readonly contentType?: string;
}

/**
 * The async object-storage seam a concrete backend (R2/S3) implements. All operations are keyed by the
 * app's existing object keys; `read`/`head` resolve to `null` for a missing key (absence is not an
 * error), while transport failures reject.
 */
export interface ObjectStore {
  /** Read an object's bytes, or `null` if the key does not exist. */
  read(key: string): Promise<Uint8Array | null>;
  /** Write (create or overwrite) an object and return its metadata. */
  write(key: string, data: Uint8Array, options?: WriteOptions): Promise<ObjectMetadata>;
  /** Delete an object. Idempotent — deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Whether an object exists. */
  exists(key: string): Promise<boolean>;
  /** Fetch an object's metadata without its bytes, or `null` if absent. */
  head(key: string): Promise<ObjectMetadata | null>;
  /** Report backend connectivity (bucket reachable + credentials valid). */
  healthCheck(): Promise<ObjectStoreHealth>;
}
