import type { JsonObject } from '@workerv2/contracts';

/**
 * Generic foundation error taxonomy. These are ENGINEERING error kinds (configuration,
 * validation, invariant, unsupported) — not product/domain errors, which belong to their
 * own subsystems in later phases.
 */
export type ErrorCode = 'CONFIG' | 'VALIDATION' | 'INVARIANT' | 'NOT_IMPLEMENTED' | 'DEPENDENCY';

export interface WorkerV2ErrorOptions {
  /** Machine-readable classification. */
  readonly code: ErrorCode;
  /** Sanitized, JSON-safe context. NEVER put secrets/PII here (Playbook §4.3.2). */
  readonly context?: JsonObject;
  /** Underlying cause, if any. */
  readonly cause?: unknown;
}

/**
 * Base class for all Worker V2 foundation errors. Carries a stable `code` and optional
 * JSON-safe `context`. Distinguishing programmatically is done via `code`, not message text.
 */
export class WorkerV2Error extends Error {
  readonly code: ErrorCode;
  readonly context: JsonObject | undefined;

  constructor(message: string, options: WorkerV2ErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.context = options.context;
    // Preserve prototype chain across the ES target/transpilation boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid or missing configuration. */
export class ConfigError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'CONFIG' });
  }
}

/** Input failed validation at a boundary. */
export class ValidationError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'VALIDATION' });
  }
}

/** A guaranteed condition was violated (a bug, not bad input). */
export class InvariantError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'INVARIANT' });
  }
}

/** A reserved seam or capability is not implemented yet. */
export class NotImplementedError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'NOT_IMPLEMENTED' });
  }
}

/** A dependency could not be resolved/provided (e.g. DI container). */
export class DependencyError extends WorkerV2Error {
  constructor(message: string, options?: Omit<WorkerV2ErrorOptions, 'code'>) {
    super(message, { ...options, code: 'DEPENDENCY' });
  }
}

/** Type guard for any Worker V2 foundation error. */
export function isWorkerV2Error(value: unknown): value is WorkerV2Error {
  return value instanceof WorkerV2Error;
}
