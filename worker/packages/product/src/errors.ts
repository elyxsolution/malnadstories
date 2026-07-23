import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A product definition, catalog, selection, resolution, or compatibility input violates the
 * Product Platform invariants: bad shapes, unknown products/options, constraint violations,
 * non-canonical ordering, or unsupported schema versions. Raised at DEFINE/VALIDATE/RESOLVE
 * time — the platform never renders, lays out, executes, or stores anything.
 */
export class ProductError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
