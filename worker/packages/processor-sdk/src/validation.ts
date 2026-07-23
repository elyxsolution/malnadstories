import type { JsonObject, Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { ProcessorContext } from './context.js';
import { ProcessorAbort } from './errors.js';

/**
 * VALIDATION HELPERS — the input/config checks a processor runs before it transforms anything.
 * All of them fail via a `permanent` `ProcessorAbort` (invalid input cannot be fixed by a
 * retry), which the base processor converts into a `permanent` `StepFailure`. Output-slot
 * conformance reuses the processing framework's shared `validateProcessorOutputs`, so output
 * discipline never drifts between the SDK and the engine.
 */

/** Assert every listed input slot is bound; abort (`permanent`) listing the missing ones. */
export function requireInputs(context: ProcessorContext, slots: readonly string[]): void {
  const missing = slots.filter((slot) => !context.hasInput(slot));
  if (missing.length > 0) {
    throw new ProcessorAbort('permanent', `Missing required input(s): ${missing.join(', ')}`, {
      missing,
    });
  }
}

/** Assert one input slot is bound and return its artifact identity. */
export function requireInput(context: ProcessorContext, slot: string): StorageKey {
  return context.input(slot);
}

/**
 * Parse + validate the processor's config through a caller-supplied pure parser, returning the
 * typed config or aborting (`permanent`) with the parser's message. Keeps config schemas OUT of
 * the SDK (no business logic here) while giving every processor one consistent config gate.
 */
export function requireConfig<T>(
  context: ProcessorContext,
  parse: (config: JsonObject) => Result<T, string>,
): T {
  const result = parse(context.config);
  if (!result.ok) {
    throw new ProcessorAbort('permanent', `Invalid processor config: ${result.error}`);
  }
  return result.value;
}

/** Abort (`permanent`) unless `condition` holds — a guard for processor preconditions. */
export function ensure(condition: unknown, message: string, detail?: JsonObject): void {
  if (!condition) throw new ProcessorAbort('permanent', message, detail);
}
