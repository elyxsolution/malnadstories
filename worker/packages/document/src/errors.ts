import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A DOCUMENT failure — an assembly/validation error. Invalid documents must never exist, so every
 * construction path that cannot produce a valid, complete document returns this (never a partial
 * document).
 */
export class DocumentError extends WorkerV2Error {
  constructor(message: string, options: Omit<WorkerV2ErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'VALIDATION' });
    this.name = 'DocumentError';
  }
}
