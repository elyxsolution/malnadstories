import type { FlagProvider, FlagValue } from './types.js';

/**
 * A `FlagProvider` backed by a fixed, in-memory map. The reference implementation for tests
 * and for statically-configured flags. Remote/dynamic providers are a later concern; they
 * satisfy the same interface.
 */
export class StaticFlagProvider implements FlagProvider {
  private readonly flags: Readonly<Record<string, FlagValue>>;

  constructor(flags: Readonly<Record<string, FlagValue>> = {}) {
    this.flags = { ...flags };
  }

  isEnabled(key: string): boolean {
    return this.flags[key] === true;
  }

  getValue<T extends FlagValue>(key: string, fallback: T): T {
    const value = this.flags[key];
    return typeof value === typeof fallback ? (value as T) : fallback;
  }
}
