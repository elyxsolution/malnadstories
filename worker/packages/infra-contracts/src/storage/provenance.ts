import type { AssetId, RunId, Timestamp } from '@workerv2/control-plane';
import type { StorageKey } from './artifact-store.js';

/**
 * The storage-neutral ROLE an artifact plays. Describes what kind of stored object this is
 * without encoding any product/business rule — it mirrors the Asset Lifecycle vocabulary
 * (Rec 14): a `canonical` master, a `derivative` of one, a finished `document`, or `other`.
 */
export type ArtifactKind = 'canonical' | 'derivative' | 'document' | 'other';

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'canonical',
  'derivative',
  'document',
  'other',
];

/**
 * PROVENANCE for a produced artifact — descriptive lineage metadata, never logic. Records which
 * run produced it (Rec: Run), the frozen version pins it was produced under (Rec: VersionSet — the
 * component→version map from a `VersionSet`), the processing step that emitted it (Rec: Processing
 * Step), the source assets it derived from (lineage), and when it was created (injected time — the
 * caller supplies the `Timestamp`; nothing here reads the clock). JSON-safe.
 */
export interface ArtifactProvenance {
  readonly runId: RunId;
  /** The processing step that produced this artifact (e.g. `canonicalize`, `render`). */
  readonly step: string;
  readonly kind: ArtifactKind;
  /** Frozen version pins under which the artifact was produced (mirrors `VersionSet.toJSON`). */
  readonly versions: Readonly<Record<string, string>>;
  /** The assets this artifact was derived from (lineage; may be empty). */
  readonly sourceAssetIds: readonly AssetId[];
  readonly createdAt: Timestamp;
}

/**
 * A first-class, immutable ARTIFACT — identified by its content address (`key`), independent of any
 * storage backend (Rec: model artifacts as first-class immutable objects). Carries the addressing
 * digest (integrity), size/content-type, and its provenance. Two byte-identical artifacts share the
 * same `key` regardless of where or how they are stored.
 */
export interface ArtifactDescriptor {
  /** Content address — the backend-independent identity (INV-10). */
  readonly key: StorageKey;
  /** Hashing algorithm used to derive the address (e.g. `sha256`). */
  readonly algorithm: string;
  /** Hex digest of the content (the `key` is `algorithm:digest`). */
  readonly digest: string;
  readonly sizeBytes: number;
  readonly contentType?: string;
  readonly provenance: ArtifactProvenance;
}
