import type { StorageKey } from '@workerv2/infra-contracts';
import type { Timestamp } from '@workerv2/control-plane';
import type {
  Processor,
  ProcessorDescriptor,
  ProcessorOutcome,
  ProcessingContext,
  StepFailure,
} from '@workerv2/processing';
import { stepFailure, validateProcessorOutputs } from '@workerv2/processing';
import type { ArtifactGateway, Clock, DiagnosticsSink, ProgressReporter } from './contracts.js';
import { ProcessorContext } from './context.js';
import type { ProcessorContextDeps } from './context.js';
import { ProcessorAbort } from './errors.js';
import { requireInputs } from './validation.js';

/**
 * The BASE PROCESSOR ABSTRACTION — the single, consistent way to build a `Processor` with this
 * SDK. A processor author supplies a descriptor and an `execute` that TRANSFORMS ARTIFACTS
 * (reads inputs from the context, produces outputs, returns the slot→artifact map); the base
 * runs the uniform lifecycle around it: report progress, validate inputs, guard
 * cancellation/deadlines, execute, then validate the produced outputs against the declared
 * slots. Every failure — a guard trip, a validation abort, or an unexpected throw — is turned
 * into a `StepFailure` OUTCOME (never an escaping exception), so the engine always receives
 * in-band data.
 *
 * The SDK implements NO concrete processor here — `execute` is the author's, and it never
 * renders, generates PDFs, or processes images within the SDK.
 */

/** The host-wired dependencies a processor runs against (the ports + optional time). */
export interface ProcessorDependencies {
  readonly artifacts: ArtifactGateway;
  readonly progress?: ProgressReporter;
  readonly diagnostics?: DiagnosticsSink;
  readonly clock?: Clock;
  /** Derive an attempt deadline from the (timeout-bearing) processing context, if desired. */
  readonly resolveDeadline?: (processing: ProcessingContext) => Timestamp | undefined;
}

/** The author-facing definition of a processor: identity + optional checks + the transform. */
export interface ProcessorSpec {
  readonly descriptor: ProcessorDescriptor;
  /** Input slots that must be bound before `execute` runs (checked automatically). */
  readonly requiredInputs?: readonly string[];
  /** Extra validation (config/inputs) — may abort via `ProcessorAbort`. */
  readonly validate?: (context: ProcessorContext) => void | Promise<void>;
  /** Transform the input Artifacts into the produced output Artifacts (slot → identity). */
  readonly execute: (context: ProcessorContext) => Promise<Record<string, StorageKey>>;
}

const NOOP_PROGRESS: ProgressReporter = { report: (): void => {} };
const NOOP_DIAGNOSTICS: DiagnosticsSink = { emit: (): void => {} };

/** Build a `Processor` from a spec + wired dependencies. The single SDK construction entry point. */
export function createProcessor(spec: ProcessorSpec, deps: ProcessorDependencies): Processor {
  return {
    descriptor: spec.descriptor,
    process: (processing): Promise<ProcessorOutcome> => runLifecycle(spec, deps, processing),
  };
}

async function runLifecycle(
  spec: ProcessorSpec,
  deps: ProcessorDependencies,
  processing: ProcessingContext,
): Promise<ProcessorOutcome> {
  const deadline = deps.resolveDeadline?.(processing);
  const contextDeps: ProcessorContextDeps = {
    artifacts: deps.artifacts,
    progress: deps.progress ?? NOOP_PROGRESS,
    diagnostics: deps.diagnostics ?? NOOP_DIAGNOSTICS,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deadline === undefined ? {} : { deadline }),
  };
  const context = new ProcessorContext(processing, contextDeps);

  try {
    // --- validate ---
    context.reportProgress({ fraction: 0, phase: 'validate' });
    context.debug(`processor "${spec.descriptor.name}" started`, { attempt: processing.attempt });
    context.guard.check();
    if (spec.requiredInputs !== undefined) requireInputs(context, spec.requiredInputs);
    if (spec.validate !== undefined) await spec.validate(context);

    // --- execute ---
    context.guard.check();
    context.reportProgress({ fraction: 0, phase: 'execute' });
    const outputs = await spec.execute(context);

    // --- finalize (output-slot conformance is the engine's shared rule) ---
    const conforms = validateProcessorOutputs(processing.expectedOutputs, outputs);
    if (!conforms.ok) {
      throw new ProcessorAbort(
        'permanent',
        `Produced outputs do not match the declared slots: ${conforms.error.message}`,
      );
    }
    context.reportProgress({ fraction: 1, phase: 'finalize' });
    context.info(`processor "${spec.descriptor.name}" completed`, {
      outputs: Object.keys(outputs),
    });
    return { ok: true, value: { outputs: { ...outputs } } };
  } catch (error) {
    const failure = toStepFailure(error);
    context.warning(`processor "${spec.descriptor.name}" failed`, {
      kind: failure.kind,
      message: failure.message,
    });
    return { ok: false, error: failure };
  }
}

/** Map any thrown value to a `StepFailure`: an abort keeps its kind; anything else is transient. */
function toStepFailure(error: unknown): StepFailure {
  if (error instanceof ProcessorAbort) {
    return stepFailure(error.failureKind, error.message, error.detail);
  }
  const message = error instanceof Error ? error.message : String(error);
  return stepFailure('transient', `Unexpected processor error: ${message}`);
}
