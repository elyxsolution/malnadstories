import type {
  ArtifactRegistry,
  IntegrityVerifier,
  StorageAdapter,
} from '@workerv2/infra-contracts';
import type { BlobStore } from './blob-store.js';
import { InMemoryBlobStore } from './blob-store.js';
import { ContentAddressedArtifactStore } from './artifact-store.js';
import { Sha256ContentAddressing } from './content-addressing.js';
import { Sha256IntegrityVerifier } from './integrity.js';
import { InMemoryArtifactRegistry } from './registry.js';

/**
 * The ARTIFACT PLATFORM facade — one assembled unit implementing the Phase-3 `StorageAdapter`
 * seam (artifacts + addressing) plus the registry and integrity verifier. The backend is
 * injected (DI): pass any `BlobStore` and every guarantee (content addressing, write-once,
 * integrity, provenance) holds unchanged — storage stays replaceable. Holds NO business logic;
 * it only wires the storage components together.
 */
export class ArtifactPlatform implements StorageAdapter {
  readonly artifacts: ContentAddressedArtifactStore;
  readonly addressing: Sha256ContentAddressing;
  readonly registry: ArtifactRegistry;
  readonly integrity: IntegrityVerifier;

  constructor(blobs: BlobStore = new InMemoryBlobStore()) {
    this.artifacts = new ContentAddressedArtifactStore(blobs);
    this.addressing = new Sha256ContentAddressing();
    this.registry = new InMemoryArtifactRegistry();
    this.integrity = new Sha256IntegrityVerifier();
  }
}
