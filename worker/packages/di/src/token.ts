/**
 * A typed injection token. Identity is a unique `symbol`; the phantom `__type` carries the
 * resolved value type `T` for compile-time safety without existing at runtime.
 */
export interface Token<T> {
  readonly key: symbol;
  readonly description: string;
  /** Phantom — never assigned at runtime. */
  readonly __type?: T;
}

/** Create a fresh, unique injection token for values of type `T`. */
export function token<T>(description: string): Token<T> {
  return { key: Symbol(description), description };
}
