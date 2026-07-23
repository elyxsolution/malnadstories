import { WorkerV2Error } from '@workerv2/errors';
import type { JsonObject } from '@workerv2/contracts';

/** A composition failure (missing artifact, invalid layer stack, degenerate geometry). */
export class CompositionError extends WorkerV2Error {
  constructor(message: string, context?: JsonObject) {
    super(message, { code: 'VALIDATION', ...(context === undefined ? {} : { context }) });
    this.name = 'CompositionError';
  }
}
