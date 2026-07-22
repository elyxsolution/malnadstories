import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A blueprint (source or serialized form) violates the blueprint invariants: bad shapes,
 * dangling references, non-tree containment, unstable/duplicate ids, unsupported schema
 * version, or out-of-bounds geometry. Raised at COMPILE/VALIDATION time — the platform never
 * executes or renders anything.
 */
export class BlueprintError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
