import { RegistrationError } from '../errors.js';
import type { Service } from './service.js';

/** An in-memory registry of hosted services, keyed by unique name. */
export class ServiceRegistry {
  private readonly services = new Map<string, Service>();

  /** Register a service. Throws `RegistrationError` on a duplicate name. */
  register(service: Service): void {
    if (this.services.has(service.name)) {
      throw new RegistrationError(`Duplicate service registration: "${service.name}"`, {
        context: { name: service.name },
      });
    }
    this.services.set(service.name, service);
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  get(name: string): Service | undefined {
    return this.services.get(name);
  }

  /** All registered services, in registration order. */
  all(): Service[] {
    return [...this.services.values()];
  }

  get size(): number {
    return this.services.size;
  }
}
