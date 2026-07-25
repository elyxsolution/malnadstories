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
 *
 * OBSERVABILITY (Phase I-4): the manager is not redesigned; it gains one OPTIONAL `ResourceObserver`
 * that it notifies on create/acquire/reset — the same "emit, don't instrument" shape processors use.
 * Chromium crashing and being silently rebuilt used to be completely invisible; it now produces a
 * counter, a warning, and an acquisition timing. With no observer supplied the behaviour is byte-for-
 * byte what it was. `peek()` and `stats()` expose state for the health probes and the resource monitor
 * WITHOUT creating anything — a health check must never launch a browser as a side effect.
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
  /**
   * The live resource, or `null` if none exists. NEVER creates one — this is what lets the resource
   * monitor count open browser pages, and the health probe report state, without a health check
   * accidentally launching Chromium.
   */
  peek(): T | null;
}

/**
 * Lifecycle notifications. Structurally compatible with the observability layer's `ResourceObserver`,
 * declared here so the resources layer does not depend on the observability layer.
 */
export interface ResourceLifecycleObserver {
  onCreated(name: string, durationMs: number): void;
  onCreateFailed(name: string, error: unknown, durationMs: number): void;
  onAcquired(name: string, durationMs: number, created: boolean): void;
  onReset(name: string, reason: 'unhealthy' | 'explicit' | 'shutdown'): void;
}

/** The default observer: notifications go nowhere, and the manager behaves exactly as before. */
const NOOP_OBSERVER: ResourceLifecycleObserver = {
  onCreated: (): void => {},
  onCreateFailed: (): void => {},
  onAcquired: (): void => {},
  onReset: (): void => {},
};

class ManagedResourceHandle<T> implements ResourceHandle<T> {
  private current: T | null = null;
  /** Serializes create/reset so concurrent `acquire()`s never launch two resources. */
  private inFlight: Promise<T> | null = null;

  constructor(
    private readonly resource: ManagedResource<T>,
    private readonly observer: ResourceLifecycleObserver = NOOP_OBSERVER,
    private readonly clock: () => number = Date.now,
  ) {}

  async acquire(): Promise<T> {
    const started = this.clock();
    if (this.current !== null) {
      if (await this.safeHealthy(this.current)) {
        this.notify(() =>
          this.observer.onAcquired(this.resource.name, this.clock() - started, false),
        );
        return this.current;
      }
      // Stale/crashed → discard and rebuild below. This is the invisible-restart case that the
      // observer exists to surface.
      await this.discard('unhealthy');
    }
    if (this.inFlight === null) {
      const createStarted = this.clock();
      this.inFlight = this.resource
        .create()
        .then((created) => {
          this.current = created;
          this.notify(() =>
            this.observer.onCreated(this.resource.name, this.clock() - createStarted),
          );
          return created;
        })
        .catch((error: unknown) => {
          this.notify(() =>
            this.observer.onCreateFailed(this.resource.name, error, this.clock() - createStarted),
          );
          throw error;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    const resource = await this.inFlight;
    this.notify(() => this.observer.onAcquired(this.resource.name, this.clock() - started, true));
    return resource;
  }

  async reset(): Promise<void> {
    await this.discard('explicit');
  }

  async health(): Promise<ResourceHealth> {
    if (this.current === null) return 'absent';
    return (await this.safeHealthy(this.current)) ? 'healthy' : 'unhealthy';
  }

  peek(): T | null {
    return this.current;
  }

  /** Whether a resource is currently live (for the manager's stats). */
  get live(): boolean {
    return this.current !== null;
  }

  /** Destroy any live resource (shutdown). */
  async dispose(): Promise<void> {
    await this.discard('shutdown');
  }

  private async discard(reason: 'unhealthy' | 'explicit' | 'shutdown'): Promise<void> {
    const existing = this.current;
    this.current = null;
    if (existing === null) return;
    this.notify(() => this.observer.onReset(this.resource.name, reason));
    try {
      await this.resource.destroy(existing);
    } catch {
      /* discarding anyway */
    }
  }

  private async safeHealthy(resource: T): Promise<boolean> {
    try {
      return await this.resource.isHealthy(resource);
    } catch {
      return false;
    }
  }

  /** An observer must never be able to break resource management. */
  private notify(emit: () => void): void {
    try {
      emit();
    } catch {
      /* observability is best-effort */
    }
  }
}

interface DisposableHandle {
  readonly live: boolean;
  dispose(): Promise<void>;
}

export class ResourceManager {
  private readonly handles: DisposableHandle[] = [];
  private readonly names: string[] = [];

  constructor(private readonly observer: ResourceLifecycleObserver = NOOP_OBSERVER) {}

  /** Register a resource and get its handle. The manager will dispose it on `shutdown()`. */
  register<T>(resource: ManagedResource<T>): ResourceHandle<T> {
    const handle = new ManagedResourceHandle<T>(resource, this.observer);
    this.handles.push(handle);
    this.names.push(resource.name);
    return handle;
  }

  /** Registered resource names, sorted — reported by `/diagnostics`. */
  get registered(): readonly string[] {
    return [...this.names].sort();
  }

  /** Counts for the `resource-manager` health probe. Does not create or probe anything. */
  stats(): { registered: number; live: number } {
    return {
      registered: this.handles.length,
      live: this.handles.filter((h) => h.live).length,
    };
  }

  /** Gracefully destroy every registered resource. Best-effort; never throws. */
  async shutdown(): Promise<void> {
    await Promise.allSettled(this.handles.map((h) => h.dispose()));
  }
}
