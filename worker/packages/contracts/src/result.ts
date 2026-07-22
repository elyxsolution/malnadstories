/**
 * A `Result<T, E>` is an explicit success/failure value — the foundation's alternative
 * to throwing for expected, recoverable outcomes. Constructors and combinators live in
 * `@workerv2/utils`; this package owns only the type.
 */

/** Successful branch carrying a value of type `T`. */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** Failure branch carrying an error of type `E`. */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Discriminated union of success (`Ok`) and failure (`Err`). Discriminate on `.ok`. */
export type Result<T, E> = Ok<T> | Err<E>;
