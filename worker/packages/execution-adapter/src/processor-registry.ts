import type { Processor, ProcessorResolver } from '@workerv2/processing';
import { AdapterError } from './errors.js';

/**
 * The PROCESSOR RESOLVER — an in-memory registry implementing the processing framework's
 * `ProcessorResolver` seam. It HOLDS processors the caller registers (image, render, assemble —
 * built in their own phases); the adapter ships NONE and implements NONE. Resolution is by
 * registry name plus an optional version constraint.
 *
 * Version policy (deliberately minimal + deterministic): an undefined range or `*` matches any
 * registered version; otherwise the constraint must equal the processor's concrete version
 * exactly. Richer semver-range grammar is additive and belongs to the capability negotiator, not
 * here — this seam only maps a NAME to an INSTANCE.
 */
export class InMemoryProcessorRegistry implements ProcessorResolver {
  private readonly byName = new Map<string, Processor>();

  /** Register a processor by its descriptor name. Throws on a duplicate name. */
  register(processor: Processor): this {
    const name = processor.descriptor.name;
    if (this.byName.has(name)) {
      throw new AdapterError(`Duplicate processor registration: "${name}"`, {
        context: { processor: name },
      });
    }
    this.byName.set(name, processor);
    return this;
  }

  resolve(name: string, versionRange?: string): Processor | null {
    const processor = this.byName.get(name);
    if (processor === undefined) return null;
    if (versionRange === undefined || versionRange === '*') return processor;
    return processor.descriptor.version === versionRange ? processor : null;
  }

  /** Registered processor names, sorted (deterministic). */
  names(): string[] {
    return [...this.byName.keys()].sort();
  }
}
