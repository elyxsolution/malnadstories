import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * An optimistic-concurrency conflict: the row changed since it was read (stale version), or an
 * insert collided with an existing id. The transaction is aborted and nothing is applied.
 */
export class ConcurrencyError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}
