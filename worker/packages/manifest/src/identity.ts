import { createHash } from 'node:crypto';
import type { Manifest, ManifestHash } from './model.js';
import { serializeManifest } from './serialize.js';

/**
 * MANIFEST IDENTITY — content addressing for manifests: `sha256:<hex>` of the UTF-8 bytes
 * of the canonical serialization. Identity depends ONLY on canonical manifest content —
 * never on time, storage, process state, or attached traces — and is byte-compatible with
 * the artifact platform's addressing (ADR-0006) and blueprint identity (ADR-0008), so a
 * canonical manifest stored as an artifact gets a storage key equal to its own hash.
 */
export const MANIFEST_HASH_ALGORITHM = 'sha256';

export function hashManifest(manifest: Manifest): ManifestHash {
  const canonical = serializeManifest(manifest);
  const digest = createHash(MANIFEST_HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
  return `${MANIFEST_HASH_ALGORITHM}:${digest}` as ManifestHash;
}
