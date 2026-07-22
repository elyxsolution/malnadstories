import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * A persistence operation failed (an adapter concern surfaced through the contract). Generic —
 * carries no database-specific detail; concrete adapters map their native errors onto this.
 */
export class PersistenceError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}

/** A storage operation failed (e.g. an overwrite of an immutable artifact was attempted). */
export class StorageError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}

/** A record could not be mapped to/from its domain object (anti-corruption boundary failure). */
export class MappingError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}
