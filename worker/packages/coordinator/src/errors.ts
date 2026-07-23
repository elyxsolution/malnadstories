import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A coordinator operation is illegal or an execution state is inconsistent: an out-of-order
 * command (dispatching a node that is not ready, reporting a node that is not running),
 * an unknown node, a broken journal, or a state that fails the coordinator validation gate.
 *
 * Raised at COORDINATION time — the coordinator decides and records transitions; it never
 * executes processors, renders, or performs I/O. Coordinator errors are always the result of
 * a bad caller sequence or a corrupt/forged state, never of the work itself failing (a failing
 * step is modelled by the declarative failure vocabulary, not by throwing).
 */
export class CoordinatorError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
