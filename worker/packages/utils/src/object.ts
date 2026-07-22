import type { DeepReadonly } from '@workerv2/contracts';

/** True for a plain object literal (not null, array, or class instance). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Safe own-property check (no prototype-chain surprises). */
export function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Recursively freeze a structure and return it as `DeepReadonly`. Used to make
 * foundation-produced values tamper-evident (supports the immutability posture). Cycles
 * are handled (already-frozen objects are skipped).
 */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value as DeepReadonly<T>;
}
