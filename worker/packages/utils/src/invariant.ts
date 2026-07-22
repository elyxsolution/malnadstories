/**
 * Assert a condition that must hold. Throws a plain `Error` when violated — foundation
 * packages that need a typed error wrap this at their own boundary (`@workerv2/errors`
 * depends on nothing here to avoid cycles). `invariant` narrows its condition for the
 * compiler on the success path.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/**
 * Exhaustiveness helper. Placed in the `default`/unreachable branch of a switch so the
 * compiler errors if a case is unhandled; throws at runtime if reached anyway.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${String(value)}`);
}
