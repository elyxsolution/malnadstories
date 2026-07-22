import { HealthRegistry } from '@workerv2/health';
import type { HealthStatus } from '@workerv2/health';
import type { Service } from '../services/service.js';

/**
 * Assemble a `HealthRegistry` from a runtime liveness check plus each service's optional health
 * contribution. Generic composition over `@workerv2/health` — the runtime owns no health logic
 * of its own beyond reporting whether it is running.
 */
export function buildRuntimeHealth(
  services: readonly Service[],
  runtimeStatus: () => HealthStatus,
): HealthRegistry {
  const registry = new HealthRegistry();
  registry.register({ name: 'runtime', check: () => ({ status: runtimeStatus() }) });
  for (const service of services) {
    if (service.healthCheck) registry.register(service.healthCheck());
  }
  return registry;
}
