import { DependencyError } from '@workerv2/errors';
import type { Token } from './token.js';

/** A factory resolves a value, possibly pulling further dependencies from the container. */
export type Factory<T> = (container: Container) => T;

interface ValueRegistration {
  readonly kind: 'value';
  readonly value: unknown;
}
interface FactoryRegistration {
  readonly kind: 'factory';
  readonly factory: Factory<unknown>;
  readonly singleton: boolean;
  instance?: { value: unknown };
}
type Registration = ValueRegistration | FactoryRegistration;

/**
 * A minimal, generic dependency-injection container — the FOUNDATION only. It supports value
 * and factory registrations, singleton caching, child scopes (which inherit parent
 * registrations and may override them), and cycle detection during resolution. It contains
 * no product wiring; later phases build their graphs on top of it.
 */
export class Container {
  private readonly registry = new Map<symbol, Registration>();
  private readonly resolving = new Set<symbol>();

  constructor(private readonly parent?: Container) {}

  /** Register a concrete value for a token. */
  registerValue<T>(t: Token<T>, value: T): this {
    this.registry.set(t.key, { kind: 'value', value });
    return this;
  }

  /**
   * Register a factory for a token. `singleton` (default true) caches the first result within
   * the scope that owns the registration.
   */
  registerFactory<T>(t: Token<T>, factory: Factory<T>, options?: { singleton?: boolean }): this {
    this.registry.set(t.key, {
      kind: 'factory',
      factory: factory as Factory<unknown>,
      singleton: options?.singleton ?? true,
    });
    return this;
  }

  /** True if this scope or an ancestor can resolve the token. */
  has<T>(t: Token<T>): boolean {
    return this.registry.has(t.key) || (this.parent?.has(t) ?? false);
  }

  /** Resolve a token to its value, or throw `DependencyError` if unregistered or cyclic. */
  resolve<T>(t: Token<T>): T {
    const owner = this.findOwner(t.key);
    if (!owner) {
      throw new DependencyError(`No provider registered for token: ${t.description}`, {
        context: { token: t.description },
      });
    }
    return owner.resolveOwned(t) as T;
  }

  /** Create a child scope that inherits (and may override) this scope's registrations. */
  createChild(): Container {
    return new Container(this);
  }

  private findOwner(key: symbol): Container | undefined {
    if (this.registry.has(key)) return this;
    return this.parent?.findOwner(key);
  }

  private resolveOwned<T>(t: Token<T>): unknown {
    const reg = this.registry.get(t.key);
    // Guaranteed present: only called on the owning scope.
    if (!reg) {
      throw new DependencyError(`No provider registered for token: ${t.description}`, {
        context: { token: t.description },
      });
    }
    if (reg.kind === 'value') return reg.value;

    if (reg.singleton && reg.instance) return reg.instance.value;

    if (this.resolving.has(t.key)) {
      throw new DependencyError(`Circular dependency while resolving: ${t.description}`, {
        context: { token: t.description },
      });
    }
    this.resolving.add(t.key);
    try {
      const value = reg.factory(this);
      if (reg.singleton) reg.instance = { value };
      return value;
    } finally {
      this.resolving.delete(t.key);
    }
  }
}
