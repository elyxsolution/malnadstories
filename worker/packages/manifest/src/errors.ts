import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A manifest (source blueprint, serialized form, or compile input) violates the manifest
 * invariants: bad shapes, dangling node references, inconsistent artifact bindings, cyclic
 * dependency graphs, invalid policies, or unsupported schema versions. Raised at
 * COMPILE/VALIDATION time — the platform never executes, schedules, or renders anything.
 */
export class ManifestError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
