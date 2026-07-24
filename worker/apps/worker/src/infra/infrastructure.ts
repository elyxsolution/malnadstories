import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { Job } from '../job.js';
import type { QueueAdapter } from '../queue.js';
import type { InfrastructureConfig } from './config.js';
import { PgBossQueueAdapter } from './queue/pgboss-queue.js';
import type { JobProducer } from './queue/pgboss-queue.js';
import { R2ObjectStore } from './storage/r2-object-store.js';
import type { ObjectStore } from './storage/object-store.js';
import { SupabasePostgresAdapter } from './database/supabase-adapter.js';
import type { DatabaseAdapter } from './database/database-adapter.js';

/**
 * INFRASTRUCTURE COMPOSITION — assembles the three production adapters (queue, object store, database)
 * from config and exposes a fail-fast connectivity PREFLIGHT. This is the single place the concrete
 * adapters are constructed; every consumer receives them by injection, so the runtime and the worker
 * application stay infrastructure-agnostic (they never import an adapter).
 *
 * Phase I-0 scope: build + connect + health-probe. NOTHING here is wired into the consume loop — the
 * worker stays idle. The preflight exists so an operator (or the boot sequence, when `WV2_INFRA=on`)
 * can PROVE the worker reaches pg-boss, R2, and Supabase before any later phase starts consuming.
 */

/** A queue adapter that also owns its connection lifecycle + the produce side (recovery re-drives through it). */
export interface ManagedQueue extends QueueAdapter<Job>, JobProducer {
  connect(): Promise<void>;
  healthCheck(): Promise<'healthy' | 'unhealthy'>;
  close(): Promise<void>;
}

/** The assembled production adapters. */
export interface Infrastructure {
  readonly queue: ManagedQueue;
  readonly objectStore: ObjectStore;
  readonly database: DatabaseAdapter;
}

/** Injection seam — supply any adapter (e.g. a fake) to override the one built from config. */
export interface InfrastructureDeps {
  readonly queue?: ManagedQueue;
  readonly objectStore?: ObjectStore;
  readonly database?: DatabaseAdapter;
}

/** Raised when a preflight connectivity/health probe fails — the worker must not proceed. */
export class InfrastructureError extends Error {
  constructor(
    readonly dependency: string,
    detail: string,
  ) {
    super(`Infrastructure "${dependency}" is not ready: ${detail}`);
    this.name = 'InfrastructureError';
  }
}

/** Construct the three adapters from config; any provided dep overrides the one built from config. */
export function createInfrastructure(
  config: InfrastructureConfig,
  deps: InfrastructureDeps = {},
): Infrastructure {
  return {
    queue: deps.queue ?? PgBossQueueAdapter.fromConfig(config.queue),
    objectStore: deps.objectStore ?? R2ObjectStore.fromConfig(config.storage),
    database: deps.database ?? SupabasePostgresAdapter.fromConfig(config.database),
  };
}

/**
 * Connect + health-probe every adapter, logging each outcome. Throws `InfrastructureError` on the first
 * failure so the process exits with a clear cause (fail fast — a worker that cannot reach its
 * infrastructure must never pretend to be ready).
 */
export async function preflightInfrastructure(
  infra: Infrastructure,
  logger: StructuredLogger,
): Promise<void> {
  await infra.database.connect();
  await probe('database', () => infra.database.healthCheck(), logger);

  await infra.queue.connect();
  await probe('queue', () => infra.queue.healthCheck(), logger);

  await probe('storage', () => infra.objectStore.healthCheck(), logger);

  logger.log({ level: 'info', message: 'infra.preflight.ok', detail: {} });
}

/** Close the connection-holding adapters (queue + database). Best-effort; never throws. */
export async function closeInfrastructure(
  infra: Infrastructure,
  logger: StructuredLogger,
): Promise<void> {
  const results = await Promise.allSettled([infra.queue.close(), infra.database.close()]);
  const failures = results.filter((r) => r.status === 'rejected').length;
  logger.log({ level: 'info', message: 'infra.closed', detail: { failures } });
}

async function probe(
  dependency: string,
  check: () => Promise<'healthy' | 'unhealthy'>,
  logger: StructuredLogger,
): Promise<void> {
  const state = await check();
  logger.log({ level: 'info', message: 'infra.preflight', detail: { dependency, state } });
  if (state !== 'healthy') {
    throw new InfrastructureError(dependency, `health check reported "${state}"`);
  }
}
