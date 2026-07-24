/**
 * THE RESOURCE MANAGER — Worker V2's generic owner of long-lived, expensive processing resources
 * (Chromium today; Sharp pools, FFmpeg, OCR, or AI models tomorrow). A processor NEVER launches or owns
 * such a resource directly; it acquires a handle from the manager, which centralizes the lifecycle:
 * lazy initialization, health checks, automatic restart on staleness/crash, and graceful shutdown.
 *
 * The abstraction has two parts: a `ManagedResource<T>` describes how to create/health-check/destroy a
 * particular resource; a `ResourceHandle<T>` is what processors use — `acquire()` returns a healthy
 * resource (creating or recreating as needed), and `reset()` forces a rebuild after a detected crash.
 * The manager owns every handle and destroys them all on `shutdown()`.
 */

/** Describes how to manage one kind of resource. Implementations are pure of scheduling concerns. */
export interface ManagedResource<T> {
  readonly name: string;
  /** Create a fresh resource (expensive; called lazily + on restart). */
  create(): Promise<T>;
  /** Cheap liveness check. A `false`/throw means the resource is stale/crashed and must be rebuilt. */
  isHealthy(resource: T): Promise<boolean> | boolean;
  /** Tear down a resource (idempotent; must not throw fatally). */
  destroy(resource: T): Promise<void>;
}

export type ResourceHealth = 'healthy' | 'unhealthy' | 'absent';

/** The processor-facing handle: acquire a healthy resource, or force a rebuild after a crash. */
export interface ResourceHandle<T> {
  /** Return a healthy resource — creating it, or rebuilding it if the current one is unhealthy. */
  acquire(): Promise<T>;
  /** Force-destroy the current resource so the next `acquire()` rebuilds it (crash recovery). */
  reset(): Promise<void>;
  /** Current health without side effects beyond the resource's own probe. */
  health(): Promise<ResourceHealth>;
}

class ManagedResourceHandle<T> implements ResourceHandle<T> {
  private current: T | null = null;
  /** Serializes create/reset so concurrent `acquire()`s never launch two resources. */
  private inFlight: Promise<T> | null = null;

  constructor(private readonly resource: ManagedResource<T>) {}

  async acquire(): Promise<T> {
    if (this.current !== null) {
      if (await this.safeHealthy(this.current)) return this.current;
      await this.reset(); // stale/crashed → discard, rebuild below
    }
    if (this.inFlight === null) {
      this.inFlight = this.resource
        .create()
        .then((created) => {
          this.current = created;
          return created;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  async reset(): Promise<void> {
    const existing = this.current;
    this.current = null;
    if (existing !== null) {
      try {
        await this.resource.destroy(existing);
      } catch {
        /* discarding anyway */
      }
    }
  }

  async health(): Promise<ResourceHealth> {
    if (this.current === null) return 'absent';
    return (await this.safeHealthy(this.current)) ? 'healthy' : 'unhealthy';
  }

  /** Destroy any live resource (shutdown). */
  async dispose(): Promise<void> {
    await this.reset();
  }

  private async safeHealthy(resource: T): Promise<boolean> {
    try {
      return await this.resource.isHealthy(resource);
    } catch {
      return false;
    }
  }
}

export class ResourceManager {
  private readonly handles: Array<{ dispose(): Promise<void> }> = [];

  /** Register a resource and get its handle. The manager will dispose it on `shutdown()`. */
  register<T>(resource: ManagedResource<T>): ResourceHandle<T> {
    const handle = new ManagedResourceHandle<T>(resource);
    this.handles.push(handle);
    return handle;
  }

  /** Gracefully destroy every registered resource. Best-effort; never throws. */
  async shutdown(): Promise<void> {
    await Promise.allSettled(this.handles.map((h) => h.dispose()));
  }
}
