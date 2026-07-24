import type { ImageBackend } from '@workerv2/image-backend';
import type { StorageBackend } from './storage/backend.js';

/**
 * HEALTH — OBSERVATIONAL readiness/liveness + dependency health for the runtime. Health reporting
 * never influences execution; it is a read-only projection of the runtime's operational state (its
 * lifecycle phase + probes of its storage backend + image backend). A real deployment exposes these
 * via HTTP endpoints; the runtime only computes them.
 */

export type HealthState = 'healthy' | 'degraded' | 'unhealthy';

export interface DependencyHealth {
  readonly name: string;
  readonly state: HealthState;
  readonly detail?: string;
}

export interface HealthReport {
  /** Liveness: the runtime process is up + its lifecycle is not stopped/failed. */
  readonly live: boolean;
  /** Readiness: the runtime is started and its dependencies are healthy. */
  readonly ready: boolean;
  readonly dependencies: readonly DependencyHealth[];
}

export interface HealthInputs {
  /** Whether the runtime lifecycle is in a live (non-stopped/non-failed) phase. */
  readonly live: boolean;
  /** Whether the runtime lifecycle has reached `running`. */
  readonly started: boolean;
  readonly storage: StorageBackend;
  readonly backend: ImageBackend;
}

/** Probe the durable storage backend with a harmless round-trip (read-only side effect: a temp key). */
function storageHealth(storage: StorageBackend): DependencyHealth {
  try {
    const probeKey = 'health:probe';
    storage.put(probeKey, new Uint8Array([1]));
    const ok = storage.has(probeKey);
    storage.delete(probeKey);
    return ok
      ? { name: 'storage', state: 'healthy' }
      : { name: 'storage', state: 'unhealthy', detail: 'probe not readable' };
  } catch (error) {
    return {
      name: 'storage',
      state: 'unhealthy',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The image backend is healthy if it reports itself + names an id. */
function backendHealth(backend: ImageBackend): DependencyHealth {
  return backend.info.id.length > 0
    ? { name: 'backend', state: 'healthy', detail: backend.info.id }
    : { name: 'backend', state: 'unhealthy', detail: 'missing backend id' };
}

/** Compute the runtime's health report (observational). */
export function reportHealth(inputs: HealthInputs): HealthReport {
  const dependencies = [storageHealth(inputs.storage), backendHealth(inputs.backend)];
  const dependenciesHealthy = dependencies.every((d) => d.state === 'healthy');
  return {
    live: inputs.live,
    ready: inputs.started && dependenciesHealthy,
    dependencies,
  };
}
