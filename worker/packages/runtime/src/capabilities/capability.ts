import { RegistrationError } from '../errors.js';

/**
 * A capability a plugin/service contributes to the runtime — a named, versioned feature marker.
 * Generic: capabilities are discovery metadata, not behavior. (Concrete capabilities such as AI
 * enhancement or OCR are plugins built in a later phase.)
 */
export interface Capability {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
}

/** An in-memory registry of capabilities, keyed by unique name. */
export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  /** Register a capability. Throws `RegistrationError` on a duplicate name. */
  register(capability: Capability): void {
    if (this.capabilities.has(capability.name)) {
      throw new RegistrationError(`Duplicate capability registration: "${capability.name}"`, {
        context: { name: capability.name },
      });
    }
    this.capabilities.set(capability.name, Object.freeze({ ...capability }));
  }

  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  get(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  /** All registered capabilities, in name-sorted order (deterministic). */
  list(): Capability[] {
    return [...this.capabilities.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  get size(): number {
    return this.capabilities.size;
  }
}
