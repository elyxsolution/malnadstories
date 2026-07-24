import type { ImageBackend } from '@workerv2/image-backend';

/**
 * A tiny, typed DEPENDENCY REGISTRY — the host's DI container. Dependencies are registered by name
 * and resolved explicitly; there are NO global singletons, NO ambient services, and NO hidden
 * runtime state. Every consumer is handed exactly what the composition root wired.
 */
export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<T>(name: string, instance: T): this {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered`);
    }
    this.services.set(name, instance);
    return this;
  }

  resolve<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`Service "${name}" is not registered`);
    return this.services.get(name) as T;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  names(): readonly string[] {
    return [...this.services.keys()].sort();
  }
}

/**
 * The IMAGE BACKEND REGISTRY — holds multiple `ImageBackend` implementations by id; the host selects
 * one by CONFIGURATION (never by processor logic). The deterministic reference backend is the
 * canonical entry; a future native/GPU backend registers here and is selected without changing any
 * processor.
 */
export class BackendRegistry {
  private readonly backends = new Map<string, ImageBackend>();

  register(id: string, backend: ImageBackend): this {
    if (this.backends.has(id)) throw new Error(`ImageBackend "${id}" is already registered`);
    this.backends.set(id, backend);
    return this;
  }

  get(id: string): ImageBackend {
    const backend = this.backends.get(id);
    if (backend === undefined) throw new Error(`ImageBackend "${id}" is not registered`);
    return backend;
  }

  has(id: string): boolean {
    return this.backends.has(id);
  }

  ids(): readonly string[] {
    return [...this.backends.keys()].sort();
  }
}
