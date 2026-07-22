// @workerv2/artifact-store — the concrete Artifact Platform implementing the Phase 3 storage
// contracts: content-addressed byte storage (sha256), immutable write-once semantics, streaming
// I/O, integrity verification, the artifact registry, artifact validation, and provenance
// metadata. The storage backend (`BlobStore`) is replaceable; artifact identity never depends
// on it. NO business logic.

// --- Content addressing (deterministic identity) ---
export {
  CONTENT_HASH_ALGORITHM,
  hashBytes,
  formatStorageKey,
  digestOf,
} from './content-addressing.js';
export { Sha256ContentAddressing } from './content-addressing.js';

// --- Storage backend seam (replaceable provider) ---
export type { StoredBlob, BlobStore } from './blob-store.js';
export { InMemoryBlobStore } from './blob-store.js';

// --- The write-once, content-addressed, streaming artifact store ---
export { ContentAddressedArtifactStore } from './artifact-store.js';

// --- Integrity verification ---
export { Sha256IntegrityVerifier } from './integrity.js';

// --- Artifact registry (provenance index) ---
export { InMemoryArtifactRegistry } from './registry.js';

// --- Provenance (descriptor assembly) ---
export { describeArtifact } from './provenance.js';

// --- Artifact validation (untrusted-input boundary) ---
export { validateArtifactDescriptor, artifactDescriptorValidator } from './validation.js';

// --- Platform facade (StorageAdapter seam) ---
export { ArtifactPlatform } from './platform.js';
