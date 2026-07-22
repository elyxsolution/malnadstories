/**
 * Nominal typing helper. `Brand<T, B>` produces a type structurally identical to `T` at
 * runtime but distinct at compile time, so primitives with meaning (ids, versions) cannot
 * be interchanged by accident. The brand is a phantom field — it never exists at runtime.
 */
declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };
