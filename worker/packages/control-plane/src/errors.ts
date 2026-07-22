import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * Attempted a state transition the lifecycle does not permit (illegal `from → trigger`).
 * A recoverable, caller-facing domain error — returned via `Result`, never thrown by the
 * domain for expected outcomes.
 */
export class TransitionError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}

/**
 * A domain policy that guards an architectural invariant was violated (e.g. one-active-run,
 * INV-6). Coded `INVARIANT` to signal it protects a hard rule, not mere input shape.
 */
export class PolicyViolationError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'INVARIANT' });
  }
}
