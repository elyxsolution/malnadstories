import type { RunId } from '@workerv2/control-plane';
import type { StorageKey } from './artifact-store.js';
import type { ArtifactDescriptor } from './provenance.js';

/**
 * The ARTIFACT REGISTRY — the index from an artifact's content-addressed identity to its
 * `ArtifactDescriptor` (provenance + integrity metadata). It is WRITE-ONCE per key (INV-2): once an
 * artifact is registered, its descriptor is immutable; a conflicting re-registration is rejected
 * (`StorageError`). Registering the identical descriptor again is an idempotent no-op (INV-7).
 *
 * The registry holds only metadata — the bytes live in the `ArtifactStore`. Both are keyed by the
 * same content address, so identity is consistent across them and independent of the backend.
 */
export interface ArtifactRegistry {
  register(descriptor: ArtifactDescriptor): Promise<void>;
  get(key: StorageKey): Promise<ArtifactDescriptor | null>;
  has(key: StorageKey): Promise<boolean>;
  /** All registered descriptors (order-stable). */
  list(): Promise<readonly ArtifactDescriptor[]>;
  /** Lineage query: descriptors whose provenance names `runId` (order-stable). */
  byRun(runId: RunId): Promise<readonly ArtifactDescriptor[]>;
}
