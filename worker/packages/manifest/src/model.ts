import type { Brand, JsonObject } from '@workerv2/contracts';
import type {
  ArtifactInputBinding,
  CancellationPolicy,
  FailurePolicy,
  RetryPolicy,
  StepCapabilityRequirement,
  StepId,
  TimeoutPolicy,
} from '@workerv2/processing';

/**
 * The MANIFEST MODEL — the immutable, deterministic, content-addressable description of
 * EXECUTABLE WORK derived from a blueprint. A manifest is the translation of blueprint
 * INTENT into processing INTENT: a DAG of WORK NODES, each explicitly declaring the
 * artifacts it CONSUMES (content-addressed bindings) and the outputs it PRODUCES, the
 * processor that will do the work (by registry name — never a code reference), the runtime
 * capabilities required, and the declarative policies governing execution.
 *
 * Deliberately REUSED from `@workerv2/processing` (no duplication): node ids are `StepId`s,
 * bindings are `ArtifactInputBinding`s, and retry/timeout/cancellation/failure/capability
 * models are the processing framework's own — so a manifest bridges into a
 * `ProcessingPipeline` with zero mapping loss. Pure data — no execution, no scheduling.
 */

/** The manifest SCHEMA version (semver). Part of the canonical content — bumping it changes every manifest's identity, by design. */
export const MANIFEST_SCHEMA_VERSION = '1.0.0';

/** A manifest's content-addressed IDENTITY: `sha256:<hex>` of its canonical serialization. */
export type ManifestHash = Brand<string, 'ManifestHash'>;

/**
 * One unit of executable work. Ids are STABLE and DERIVED from the blueprint structure by
 * the compiler (`render:cover`, `render:spread:NNNN`, `assemble:album`) — never random —
 * which is what makes the diff model meaningful across recompilations.
 */
export interface WorkNode {
  readonly id: StepId;
  /** The processor to run, by registry name (an engine resolves it later — data, not code). */
  readonly processor: string;
  /** Compatible processor versions (opaque range; engine-negotiated). */
  readonly processorVersionRange?: string;
  /** Upstream nodes this node waits for — strictly ascending (canonical order). */
  readonly dependsOn: readonly StepId[];
  /** EXPLICIT consumed artifacts: named input slots → content-addressed artifact or upstream output. */
  readonly consumes: Readonly<Record<string, ArtifactInputBinding>>;
  /** EXPLICIT produced outputs: named slots (artifact identities exist only at run time) — strictly ascending. */
  readonly produces: readonly string[];
  /** Runtime capabilities the hosting worker must offer — strictly ascending by name. */
  readonly requires: readonly StepCapabilityRequirement[];
  /** Node-specific processor configuration (JSON-safe; part of the manifest's identity). */
  readonly config: JsonObject;
  readonly retry: RetryPolicy;
  readonly timeout?: TimeoutPolicy;
  readonly cancellation: CancellationPolicy;
  readonly failure: FailurePolicy;
}

/**
 * A validated, immutable MANIFEST: the schema version, the album it serves, the content
 * hash of the blueprint it was derived from (provenance — part of identity), and the work
 * nodes sorted by id (canonical node order; execution order is derived from `dependsOn`,
 * never from list position). Constructed only by the compiler or the parse/validation
 * boundary; always deep-frozen. Self-contained: every reference is a content address or an
 * in-manifest node id — no live-state, domain, or DB references.
 */
export interface Manifest {
  readonly schemaVersion: string;
  readonly albumId: string;
  /** Content hash of the source blueprint (`sha256:<hex>`) — also consumed as an artifact by the work nodes. */
  readonly blueprint: string;
  readonly nodes: readonly WorkNode[];
}

/** Look up a work node by id (nodes are id-sorted; linear scan is fine at manifest scale). */
export function nodeById(manifest: Manifest, id: string): WorkNode | undefined {
  return manifest.nodes.find((n) => n.id === id);
}
