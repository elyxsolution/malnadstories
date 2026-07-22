import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { ProcessingContext } from './context.js';
import type { StepFailure } from './policies/failure.js';

/**
 * PROCESSOR CONTRACTS — the interfaces a future execution engine implements/hosts. The
 * framework ships NO processor and NO engine; these contracts pin the seam so every
 * processing platform (image, render/PDF, manufacturing) plugs in identically.
 */

/** Identity + version of a processor implementation (engine-registered; step-referenced by name). */
export interface ProcessorDescriptor {
  readonly name: string;
  /** Concrete semver of the implementation (negotiated against a step's version range). */
  readonly version: string;
  readonly description?: string;
}

/** A successful attempt: every expected output slot filled with a produced artifact identity. */
export interface ProcessorSuccess {
  readonly outputs: Readonly<Record<string, StorageKey>>;
}

/** The outcome of one attempt — explicit success/failure, never thrown control flow. */
export type ProcessorOutcome = Result<ProcessorSuccess, StepFailure>;

/**
 * A processor: a pure-at-the-boundary unit of work that consumes and produces ARTIFACTS
 * (content addresses via the context), holding no domain/DB access of its own. Idempotency is
 * contractual (INV-7): processing the same context twice must yield the same outcome — natural
 * here, because write-once content-addressed outputs make re-production a no-op.
 */
export interface Processor {
  readonly descriptor: ProcessorDescriptor;
  process(context: ProcessingContext): Promise<ProcessorOutcome>;
}

/** Engine-side lookup seam: resolve a step's processor name (+ version range) to an instance. */
export interface ProcessorResolver {
  resolve(name: string, versionRange?: string): Processor | null;
}

/**
 * PURE conformance check every engine applies to a successful outcome: the processor must fill
 * EXACTLY the expected output slots — no missing, no undeclared extras. Shared here so output
 * discipline can never drift between engines.
 */
export function validateProcessorOutputs(
  expectedOutputs: readonly string[],
  outputs: Readonly<Record<string, StorageKey>>,
): Result<void, ValidationError> {
  const produced = Object.keys(outputs).sort();
  const expected = [...expectedOutputs].sort();
  const missing = expected.filter((slot) => !(slot in outputs));
  const extra = produced.filter((slot) => !expected.includes(slot));
  if (missing.length > 0 || extra.length > 0) {
    return err(
      new ValidationError("Processor outputs do not match the step's declared output slots", {
        context: { missing, extra },
      }),
    );
  }
  for (const [slot, key] of Object.entries(outputs)) {
    if (key.trim() === '') {
      return err(
        new ValidationError(`Processor output "${slot}" has an empty artifact identity`, {
          context: { slot },
        }),
      );
    }
  }
  return ok(undefined);
}
