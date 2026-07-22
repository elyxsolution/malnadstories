import type { ArtifactDescriptor, ArtifactProvenance } from '@workerv2/infra-contracts';
import { hashBytes, formatStorageKey, CONTENT_HASH_ALGORITHM } from './content-addressing.js';

/**
 * Build the immutable `ArtifactDescriptor` for a block of content + its provenance. Pure and
 * deterministic: identity (key/digest) derives from the bytes alone; time comes in through
 * `provenance.createdAt` (injected — nothing here reads the clock). This is the single place a
 * descriptor is assembled, so digest/key/size can never disagree with the content.
 */
export function describeArtifact(
  data: Uint8Array,
  provenance: ArtifactProvenance,
  contentType?: string,
): ArtifactDescriptor {
  const digest = hashBytes(data);
  const base = {
    key: formatStorageKey(digest),
    algorithm: CONTENT_HASH_ALGORITHM,
    digest,
    sizeBytes: data.byteLength,
    provenance,
  };
  return contentType === undefined ? base : { ...base, contentType };
}
