import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * An INFRASTRUCTURE error raised while driving a run: a wiring failure (an unresolved processor
 * or unmet capability caught by the pre-flight gate), or a coordinator command the adapter fed
 * out of sequence (a bug in the driver, not in the work). Distinct from a `StepFailure` — a
 * FAILING step is normal, declarative, in-band data the coordinator interprets; an
 * `AdapterError` means the adapter (the effect layer) could not do its job. The adapter never
 * turns a step's business failure into an `AdapterError`.
 */
export class AdapterError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}
