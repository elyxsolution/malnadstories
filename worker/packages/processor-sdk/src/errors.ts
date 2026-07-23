import type { JsonObject } from '@workerv2/contracts';
import { WorkerV2Error } from '@workerv2/errors';
import type { FailureKind } from '@workerv2/processing';

/**
 * A controlled ABORT of a processor attempt — the SDK's in-band way for a processor (or a
 * validation/guard helper) to end the current attempt with a declared `FailureKind`. The base
 * processor CATCHES it and turns it into a `StepFailure` outcome, so a processor never has to
 * throw ad-hoc errors or hand-build failure results. Cancellation and deadline guards raise
 * `cancelled` / `timeout` aborts; validation raises `permanent` aborts.
 *
 * It is NOT a bug signal — it is the normal, declarative failure path. Unexpected THROWN errors
 * (not `ProcessorAbort`) are treated conservatively as `transient` by the base processor.
 */
export class ProcessorAbort extends WorkerV2Error {
  readonly failureKind: FailureKind;
  readonly detail: JsonObject | undefined;

  constructor(failureKind: FailureKind, message: string, detail?: JsonObject) {
    super(message, { code: 'VALIDATION', ...(detail === undefined ? {} : { context: detail }) });
    this.failureKind = failureKind;
    this.detail = detail;
  }
}

/** Raise a `permanent` abort (invalid input/config — retrying cannot help). */
export function abortPermanent(message: string, detail?: JsonObject): never {
  throw new ProcessorAbort('permanent', message, detail);
}

/** Raise a `transient` abort (a dependency hiccup — a retry may succeed). */
export function abortTransient(message: string, detail?: JsonObject): never {
  throw new ProcessorAbort('transient', message, detail);
}
