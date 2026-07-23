// Backend error vocabulary. Two shapes: a `BackendError` for a transformation that cannot proceed
// (bad decode, out-of-bounds op) and reuse of the shared `ValidationError` for output-validation
// failures. Both extend the workspace error base; no bespoke error hierarchy.

import { WorkerV2Error } from '@workerv2/errors';
import type { JsonObject } from '@workerv2/contracts';

/** A pixel-transformation failure (undecodable input, out-of-bounds operation, unsupported format). */
export class BackendError extends WorkerV2Error {
  constructor(message: string, context?: JsonObject) {
    super(message, { code: 'DEPENDENCY', ...(context === undefined ? {} : { context }) });
    this.name = 'BackendError';
  }
}
