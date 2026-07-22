import { WorkerV2Error } from '@workerv2/errors';
import type { WorkerV2ErrorOptions } from '@workerv2/errors';

/**
 * The service dependency graph is invalid — a missing dependency or a cycle. Detected at
 * runtime build time (deterministic validation), before anything starts.
 */
export class DependencyGraphError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}

/**
 * The runtime was driven through an illegal lifecycle transition (a programming error — e.g.
 * starting an already-stopped runtime). Coded `INVARIANT`.
 */
export class LifecycleError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'INVARIANT' });
  }
}

/** A registration conflict (duplicate service / capability / plugin name). */
export class RegistrationError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'INVARIANT' });
  }
}
