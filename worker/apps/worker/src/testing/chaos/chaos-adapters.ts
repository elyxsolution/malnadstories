import type { Job } from '../../job.js';
import type { QueueAdapter } from '../../queue.js';
import type {
  ObjectMetadata,
  ObjectStore,
  ObjectStoreHealth,
  WriteOptions,
} from '../../infra/storage/object-store.js';
import type {
  DatabaseAdapter,
  DatabaseHealth,
  DatabaseTransaction,
} from '../../infra/database/database-adapter.js';
import type {
  PageRenderer,
  RenderRequest,
  RenderResult,
} from '../../processors/pdf/page-renderer.js';
import { RendererCrashedError } from '../../processors/pdf/page-renderer.js';
import type { FaultController } from './faults.js';

/**
 * CHAOS DECORATORS — one per infrastructure port.
 *
 * Each wraps a real (or fake) adapter, asks the `FaultController` whether to misbehave, and
 * otherwise delegates verbatim. Because they implement the SAME interfaces, they can be substituted
 * anywhere the worker accepts an adapter — including into a real `WorkerApplication` — without any
 * production module knowing chaos exists.
 *
 * Note what is NOT here: no processor decorator. Faults are injected at the INFRASTRUCTURE boundary
 * only, because that is where real failures happen. Injecting a fault inside a processor would test
 * the fault, not the architecture's response to a dependency failing.
 */

/** Faults on R2: outage, slow storage, timeouts. */
export class ChaosObjectStore implements ObjectStore {
  constructor(
    private readonly inner: ObjectStore,
    private readonly faults: FaultController,
    private readonly target = 'storage',
  ) {}

  async read(key: string): Promise<Uint8Array | null> {
    await this.faults.intercept(this.target, 'read');
    return this.inner.read(key);
  }

  async write(key: string, data: Uint8Array, options?: WriteOptions): Promise<ObjectMetadata> {
    await this.faults.intercept(this.target, 'write');
    return this.inner.write(key, data, options);
  }

  async delete(key: string): Promise<void> {
    await this.faults.intercept(this.target, 'delete');
    return this.inner.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    await this.faults.intercept(this.target, 'exists');
    return this.inner.exists(key);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    await this.faults.intercept(this.target, 'head');
    return this.inner.head(key);
  }

  /**
   * Health reflects the injected outage rather than throwing, because that is what a real adapter
   * does — this is precisely the path that must turn into `ready: false` instead of a crash.
   */
  async healthCheck(): Promise<ObjectStoreHealth> {
    try {
      await this.faults.intercept(this.target, 'healthCheck');
    } catch {
      return 'unhealthy';
    }
    return this.inner.healthCheck();
  }
}

/** Faults on Postgres: outage, slow queries, timeouts. */
export class ChaosDatabase implements DatabaseAdapter {
  constructor(
    private readonly inner: DatabaseAdapter,
    private readonly faults: FaultController,
    private readonly target = 'database',
  ) {}

  async connect(): Promise<void> {
    await this.faults.intercept(this.target, 'connect');
    return this.inner.connect();
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]> {
    await this.faults.intercept(this.target, 'query');
    return this.inner.query<T>(text, params);
  }

  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    await this.faults.intercept(this.target, 'transaction');
    return this.inner.transaction(fn);
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      await this.faults.intercept(this.target, 'healthCheck');
    } catch {
      return 'unhealthy';
    }
    return this.inner.healthCheck();
  }

  async close(): Promise<void> {
    return this.inner.close(); // shutdown must never be blocked by chaos
  }
}

/**
 * Faults on Chromium. A `crash` is translated into the renderer's OWN `RendererCrashedError`, so the
 * PDF processor classifies it exactly as it would a real `Target closed` — the point is to exercise
 * the production classification and resource-reset path, not to see an alien error propagate.
 */
export class ChaosRenderer implements PageRenderer {
  constructor(
    private readonly inner: PageRenderer,
    private readonly faults: FaultController,
    private readonly target = 'renderer',
  ) {}

  async render(request: RenderRequest): Promise<RenderResult> {
    try {
      await this.faults.intercept(this.target, 'render');
    } catch (error) {
      throw new RendererCrashedError(error instanceof Error ? error.message : String(error));
    }
    return this.inner.render(request);
  }
}

/** Faults on the broker: queue delays, poll outages, ack/nack failures. */
export class ChaosQueue implements QueueAdapter<Job> {
  constructor(
    private readonly inner: QueueAdapter<Job>,
    private readonly faults: FaultController,
    private readonly target = 'queue',
  ) {}

  async poll(filter?: readonly string[]): Promise<Job | null> {
    await this.faults.intercept(this.target, 'poll');
    return this.inner.poll(filter);
  }

  async ack(jobId: string): Promise<void> {
    await this.faults.intercept(this.target, 'ack');
    return this.inner.ack(jobId);
  }

  async nack(jobId: string, error: unknown): Promise<void> {
    await this.faults.intercept(this.target, 'nack');
    return this.inner.nack(jobId, error);
  }
}
