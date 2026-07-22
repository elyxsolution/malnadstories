/** A feature-flag value. Kept to primitives on purpose (config-like, not arbitrary data). */
export type FlagValue = boolean | number | string;

/**
 * The feature-flag abstraction. Implementations decide the source (static map, remote
 * service). `isEnabled` is a convenience for boolean flags; `getValue` returns a typed value
 * with a fallback so callers never receive `undefined`.
 */
export interface FlagProvider {
  /** True iff the flag exists and its value is boolean `true`. */
  isEnabled(key: string): boolean;
  /** Typed value with a fallback used when the flag is absent. */
  getValue<T extends FlagValue>(key: string, fallback: T): T;
}
