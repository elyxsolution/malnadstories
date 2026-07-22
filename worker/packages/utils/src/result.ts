import type { Result, Ok, Err } from '@workerv2/contracts';

/** Construct a success `Result`. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct a failure `Result`. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Type guard: narrows a `Result` to its success branch. */
export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

/** Type guard: narrows a `Result` to its failure branch. */
export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Map the success value; failures pass through unchanged. */
export function mapResult<T, E, U>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Map the error; successes pass through unchanged. */
export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

/** Extract the success value or return `fallback` on failure. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
