import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A pipeline (or step/plan) definition is invalid: duplicate ids, unknown/self dependencies,
 * a dependency cycle, an input bound to an undeclared output, or an invalid policy. Raised at
 * DEFINITION time — the framework validates declarations; it never executes them.
 */
export class PipelineDefinitionError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
