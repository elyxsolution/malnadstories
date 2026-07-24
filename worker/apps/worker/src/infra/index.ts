/**
 * INFRASTRUCTURE LAYER — public surface of the worker's production adapters. Imported LAZILY by the
 * application (a dynamic import gated on `WV2_INFRA=on`), so the default, infrastructure-less worker
 * never loads the external SDKs (pg-boss / aws-sdk / postgres) and the self-contained bundle keeps its
 * "Node built-ins only" default boot path.
 */

// --- Config ---
export {
  loadInfrastructureConfig,
  loadProcessorConfig,
  WORKER_QUEUES,
  ConfigError,
} from './config.js';
export type {
  InfrastructureConfig,
  QueueInfraConfig,
  StorageInfraConfig,
  DatabaseInfraConfig,
  RenderInfraConfig,
  RecoveryInfraConfig,
  ProcessorConfig,
} from './config.js';

// --- Composition + preflight ---
export {
  createInfrastructure,
  preflightInfrastructure,
  closeInfrastructure,
  InfrastructureError,
} from './infrastructure.js';
export type { Infrastructure, InfrastructureDeps, ManagedQueue } from './infrastructure.js';

// --- Queue adapter (pg-boss) ---
export { PgBossQueueAdapter } from './queue/pgboss-queue.js';
export type {
  PgBossLike,
  PgBossJobWithMetadata,
  PgBossStopOptions,
  QueueHealth,
  JobProducer,
} from './queue/pgboss-queue.js';

// --- Object store (R2) ---
export { R2ObjectStore } from './storage/r2-object-store.js';
export type { S3Like } from './storage/r2-object-store.js';
export type {
  ObjectStore,
  ObjectMetadata,
  ObjectStoreHealth,
  WriteOptions,
} from './storage/object-store.js';

// --- Database adapter (Supabase Postgres) ---
export { SupabasePostgresAdapter, postgresSqlClient } from './database/supabase-adapter.js';
export type { SqlClient } from './database/supabase-adapter.js';
export type {
  DatabaseAdapter,
  DatabaseTransaction,
  DatabaseHealth,
} from './database/database-adapter.js';
