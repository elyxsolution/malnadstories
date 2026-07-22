import type { Result } from '@workerv2/contracts';
import type { JsonObject } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * A validation contract: turn untrusted `unknown` input into a typed `T`, or a `ValidationError`.
 * This is the boundary seam concrete adapters use to validate persistence/transport input before
 * it reaches the domain. It is an interface — the framework provides no schema library
 * (dependency inversion; concrete validators plug in later).
 */
export interface Validator<T> {
  validate(input: unknown): Result<T, ValidationError>;
}

/** Helper: a successful validation result. */
export function valid<T>(value: T): Result<T, ValidationError> {
  return ok(value);
}

/** Helper: a failed validation result carrying a `ValidationError`. */
export function invalid<T>(message: string, context?: JsonObject): Result<T, ValidationError> {
  return err(
    context === undefined
      ? new ValidationError(message)
      : new ValidationError(message, { context }),
  );
}
