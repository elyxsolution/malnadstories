import type { JsonObject } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { StepId } from './ids.js';
import type { StepCapabilityRequirement } from './capabilities.js';
import type { RetryPolicy } from './policies/retry.js';
import type { TimeoutPolicy } from './policies/timeout.js';
import type { CancellationPolicy } from './policies/cancellation.js';
import type { FailurePolicy } from './policies/failure.js';

/**
 * The step model is ARTIFACT-CENTRIC: steps consume and produce ARTIFACT IDENTITIES
 * (content-addressed `StorageKey`s), never files or paths. An input is bound either to a
 * pre-existing artifact (by its content address) or to a named output of an upstream step —
 * whose concrete identity exists only after that step runs, so it is referenced symbolically.
 */
export type ArtifactInputBinding =
  | { readonly kind: 'artifact'; readonly key: StorageKey }
  | { readonly kind: 'step-output'; readonly stepId: StepId; readonly output: string };

/** Bind an input slot to an already-existing artifact by content address. */
export function fromArtifact(key: StorageKey): ArtifactInputBinding {
  return { kind: 'artifact', key };
}

/** Bind an input slot to the named output of an upstream step. */
export function fromStepOutput(stepId: StepId, output: string): ArtifactInputBinding {
  return { kind: 'step-output', stepId, output };
}

/**
 * One validated, immutable PROCESSING STEP — a pure declaration (INV-5): which processor runs
 * (by name + compatible version range, resolved by an engine later), what artifacts it consumes
 * and produces, which steps it depends on, which runtime capabilities it requires, and the
 * declarative retry/timeout/cancellation/failure policies governing it. Construction happens
 * only through `definePipeline` (which validates and freezes); the framework never executes one.
 */
export interface ProcessingStep {
  readonly id: StepId;
  /** Human-readable label (defaults to the id). */
  readonly name: string;
  /** The processor to run, by registry name — never a code reference (keeps the model data). */
  readonly processor: string;
  /** Compatible processor versions (opaque range; engine-negotiated). */
  readonly processorVersionRange?: string;
  readonly dependsOn: readonly StepId[];
  /** Named input slots → artifact bindings. */
  readonly inputs: Readonly<Record<string, ArtifactInputBinding>>;
  /** Named output slots this step's processor must produce (artifact identities at run time). */
  readonly outputs: readonly string[];
  /** Runtime capabilities the hosting worker must offer for this step. */
  readonly requires: readonly StepCapabilityRequirement[];
  /** Step-specific processor configuration (JSON-safe; validated by the processor's own schema later). */
  readonly config: JsonObject;
  readonly retry: RetryPolicy;
  readonly timeout?: TimeoutPolicy;
  readonly cancellation: CancellationPolicy;
  readonly failure: FailurePolicy;
}

/**
 * The author-facing SPEC for a step (plain strings; optional fields defaulted). `definePipeline`
 * validates specs into `ProcessingStep`s — specs never leave the definition boundary.
 */
export interface ProcessingStepSpec {
  readonly id: string;
  readonly name?: string;
  readonly processor: string;
  readonly processorVersionRange?: string;
  readonly dependsOn?: readonly string[];
  readonly inputs?: Readonly<
    Record<
      string,
      | { readonly kind: 'artifact'; readonly key: string }
      | { readonly kind: 'step-output'; readonly stepId: string; readonly output: string }
    >
  >;
  readonly outputs?: readonly string[];
  readonly requires?: readonly StepCapabilityRequirement[];
  readonly config?: JsonObject;
  readonly retry?: RetryPolicy;
  readonly timeout?: TimeoutPolicy;
  readonly cancellation?: CancellationPolicy;
  readonly failure?: FailurePolicy;
}
