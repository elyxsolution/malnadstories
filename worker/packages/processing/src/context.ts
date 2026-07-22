import type { JsonObject, Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { PipelineId, StepId } from './ids.js';
import type { CancellationSignal } from './policies/cancellation.js';
import { NEVER_CANCELLED } from './policies/cancellation.js';

/**
 * The PROCESSING CONTEXT — the immutable, fully-RESOLVED data a future engine hands a processor
 * for one attempt of one step. Artifact-centric: inputs are resolved content addresses
 * (`StorageKey`), never files/paths; outputs are the slot names the processor must fill with
 * produced artifact identities. Deterministic by construction: time (`startedAt`) and version
 * pins are INJECTED values frozen into the context — a processor reading only its context
 * cannot observe ambient state.
 */
export interface ProcessingContext {
  readonly runId: RunId;
  readonly pipelineId: PipelineId;
  readonly stepId: StepId;
  /** 1-based attempt number (1 = first attempt). */
  readonly attempt: number;
  /** Input slot → resolved artifact identity. Every step-output binding is resolved by now. */
  readonly inputs: Readonly<Record<string, StorageKey>>;
  /** The output slots the processor must produce. */
  readonly expectedOutputs: readonly string[];
  /** The step's processor configuration (JSON-safe). */
  readonly config: JsonObject;
  /** The run's frozen version pins (INV-11), mirrored for the processor. */
  readonly versions: Readonly<Record<string, string>>;
  /** When this attempt began — injected by the engine, never read from a clock here. */
  readonly startedAt: Timestamp;
  /** Read-only cancellation signal (engine-implemented; `NEVER_CANCELLED` outside an engine). */
  readonly cancellation: CancellationSignal;
}

export interface ProcessingContextSpec {
  readonly runId: RunId;
  readonly pipelineId: PipelineId;
  readonly stepId: StepId;
  readonly attempt: number;
  readonly inputs: Readonly<Record<string, StorageKey>>;
  readonly expectedOutputs: readonly string[];
  readonly config?: JsonObject;
  readonly versions?: Readonly<Record<string, string>>;
  readonly startedAt: Timestamp;
  readonly cancellation?: CancellationSignal;
}

/**
 * Build a validated, frozen `ProcessingContext`. The data fields are deep-frozen; the
 * cancellation signal is stored as-given (it is a live engine object, not data — freezing it
 * would break engine implementations).
 */
export function makeProcessingContext(
  spec: ProcessingContextSpec,
): Result<ProcessingContext, ValidationError> {
  if (!Number.isInteger(spec.attempt) || spec.attempt < 1) {
    return err(
      new ValidationError('ProcessingContext.attempt must be an integer >= 1', {
        context: { attempt: spec.attempt },
      }),
    );
  }
  const data = {
    runId: spec.runId,
    pipelineId: spec.pipelineId,
    stepId: spec.stepId,
    attempt: spec.attempt,
    inputs: { ...spec.inputs },
    expectedOutputs: [...spec.expectedOutputs],
    config: spec.config ?? {},
    versions: { ...(spec.versions ?? {}) },
    startedAt: spec.startedAt,
  };
  deepFreeze(data);
  const context: ProcessingContext = Object.freeze({
    ...data,
    cancellation: spec.cancellation ?? NEVER_CANCELLED,
  });
  return ok(context);
}
