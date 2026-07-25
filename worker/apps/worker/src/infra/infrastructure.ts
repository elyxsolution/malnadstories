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

/** The outcome of connecting + probing one dependency. */
export interface InfraProbe {
  readonly dependency: 'database' | 'queue' | 'storage';
  readonly state: 'healthy' | 'unhealthy';
  /** How long connect + probe took (ms) — a slow dependency is worth seeing at boot. */
  readonly durationMs: number;
}

/**
 * Connect + health-probe every adapter and RETURN the outcomes. Throws `InfrastructureError` on the
 * first failure so the process exits with a clear cause (fail fast — a worker that cannot reach its
 * infrastructure must never pretend to be ready).
 *
 * OBSERVABILITY (Phase I-4): this function no longer logs. It used to write three `infra.preflight`
 * lines and an `infra.preflight.ok` of its own, which duplicated — and disagreed in shape with — the
 * startup report. It now REPORTS RESULTS and the caller (`StartupDiagnostics`) decides how to present
 * them, so connectivity appears exactly once, inside the single startup report.
 */
export async function preflightInfrastructure(infra: Infrastructure): Promise<InfraProbe[]> {
  const probes: InfraProbe[] = [];
  probes.push(
    await probe('database', async () => {
      await infra.database.connect();
      return infra.database.healthCheck();
    }),
  );
  probes.push(
    await probe('queue', async () => {
      await infra.queue.connect();
      return infra.queue.healthCheck();
    }),
  );
  probes.push(await probe('storage', () => infra.objectStore.healthCheck()));
  return probes;
}

/** Close the connection-holding adapters (queue + database). Best-effort; never throws. */
export async function closeInfrastructure(infra: Infrastructure): Promise<{ failures: number }> {
  const results = await Promise.allSettled([infra.queue.close(), infra.database.close()]);
  return { failures: results.filter((r) => r.status === 'rejected').length };
}

async function probe(
  dependency: InfraProbe['dependency'],
  check: () => Promise<'healthy' | 'unhealthy'>,
): Promise<InfraProbe> {
  const started = Date.now();
  const state = await check();
  if (state !== 'healthy') {
    throw new InfrastructureError(dependency, `health check reported "${state}"`);
  }
  return { dependency, state, durationMs: Date.now() - started };
}
