import { createHash } from 'node:crypto';
import type { ContentAddressing, StorageKey } from '@workerv2/infra-contracts';

/**
 * Content addressing — deterministic, backend-independent identity derived purely from the bytes.
 * The algorithm is sha256; the address is `sha256:<hex-digest>`. Identical content always yields
 * an identical key (INV-10), no matter which storage backend holds it, so an artifact's identity is
 * decoupled from where it lives. There is NO business logic here — only hashing.
 */
export const CONTENT_HASH_ALGORITHM = 'sha256';

/** Hex digest (lower-case) of the content under {@link CONTENT_HASH_ALGORITHM}. */
export function hashBytes(data: Uint8Array): string {
  return createHash(CONTENT_HASH_ALGORITHM).update(data).digest('hex');
}

/** Format a digest into a content-addressed `StorageKey` (`algorithm:digest`). */
export function formatStorageKey(digest: string): StorageKey {
  return `${CONTENT_HASH_ALGORITHM}:${digest}` as StorageKey;
}

/** The digest portion of a content-addressed key, or `null` if it is not a well-formed address. */
export function digestOf(key: StorageKey): string | null {
  const prefix = `${CONTENT_HASH_ALGORITHM}:`;
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : null;
}

/** The default sha256 {@link ContentAddressing}. Pure and deterministic. */
export class Sha256ContentAddressing implements ContentAddressing {
  address(data: Uint8Array): StorageKey {
    return formatStorageKey(hashBytes(data));
  }
}
