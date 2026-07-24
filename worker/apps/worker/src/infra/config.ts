import { ConfigError, parsePositiveInt, requireEnv } from '../config-error.js';

/**
 * INFRASTRUCTURE CONFIGURATION — the external, injectable config for the production I/O adapters
 * (pg-boss queue, Cloudflare R2 object store, Supabase Postgres). It is kept ENTIRELY separate from
 * the runtime config (which selects the pure execution engine's durable storage) and the processor
 * config (which selects which handlers run) — three orthogonal concerns, three types.
 *
 * Infrastructure is STRICTLY OPT-IN: `loadInfrastructureConfig` returns `null` unless `WV2_INFRA=on`.
 * With the flag off (the default, and every unit test), the worker builds no adapters, opens no
 * connections, and behaves exactly as before. With the flag on, EVERY required variable is validated
 * up front and a missing one FAILS FAST — a half-configured worker never starts.
 *
 * The variable names deliberately MIRROR the application's own (`DIRECT_URL`, `R2_*`) so the worker
 * and the Next.js app read one shared secret set — no divergence, no duplicated truth.
 */

/**
 * The five broker queues the application enqueues onto (`src/lib/queue.ts`). The worker declares them
 * so a fresh deployment's queues exist before anything is consumed (pg-boss `createQueue` is
 * idempotent). Consuming these is a LATER phase — declaring them here changes no behaviour.
 */
export const WORKER_QUEUES = [
  'image-hardening',
  'album-pdf',
  'r2-cleanup',
  'cover-thumbnail',
  'blueprint-thumbnail',
] as const;

/** pg-boss connection: a Postgres SESSION connection string (port 5432 — the transaction pooler cannot host pg-boss). */
export interface QueueInfraConfig {
  readonly connectionString: string;
  /** The queues this worker is responsible for (declared idempotently on connect). */
  readonly queues: readonly string[];
  /** Optional `application_name` for the pg-boss connection (server-side visibility). */
  readonly applicationName: string;
}

/** Cloudflare R2 (S3-compatible) object storage — mutable, app-owned keys (NOT the runtime's content-addressed store). */
export interface StorageInfraConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** Supabase Postgres, service-role (superuser) access over the DIRECT (session) connection — supports real transactions. */
export interface DatabaseInfraConfig {
  readonly connectionString: string;
  /** Upper bound on pooled connections held by the worker's DB adapter. */
  readonly maxConnections: number;
}

/** Album-PDF rendering config — the app origin Chromium navigates to (the print route). */
export interface RenderInfraConfig {
  readonly appUrl: string;
}

/** Recovery/self-healing config — the periodic sweep + per-domain stale thresholds + caps. */
export interface RecoveryInfraConfig {
  /** Whether the recovery scheduler runs (default on; `WV2_RECOVERY=off` disables). */
  readonly enabled: boolean;
  /** Base interval between sweeps (ms). */
  readonly intervalMs: number;
  /** Random jitter added per sweep (ms) — de-syncs multiple workers. */
  readonly jitterMs: number;
  /** Max items healed per processor per sweep (bounded — no full scans). */
  readonly batchSize: number;
  /** A `pending` photo older than this is re-driven. */
  readonly imageStalePendingMs: number;
  /** A `generating` album PDF older than this is re-driven (MUST exceed a render's worst-case runtime). */
  readonly pdfStaleMs: number;
  /** Give up on a PDF (→ failed) after this many drives. */
  readonly pdfMaxAttempts: number;
  /** Fresh print-token TTL when re-driving a PDF (ms). */
  readonly pdfTokenTtlMs: number;
}

/** The composite infrastructure config. `null` when infrastructure is disabled (`WV2_INFRA` != `on`). */
export interface InfrastructureConfig {
  readonly queue: QueueInfraConfig;
  readonly storage: StorageInfraConfig;
  readonly database: DatabaseInfraConfig;
  readonly render: RenderInfraConfig;
  readonly recovery: RecoveryInfraConfig;
}

/**
 * Build the infrastructure config from the environment, or `null` when disabled. Enabled only by
 * `WV2_INFRA=on`; when enabled, every required variable is mandatory (fail fast).
 */
export function loadInfrastructureConfig(
  env: Readonly<Record<string, string | undefined>>,
): InfrastructureConfig | null {
  if (env['WV2_INFRA'] !== 'on') return null;

  // pg-boss AND the DB adapter share the DIRECT (session) connection — the same one the app uses.
  const directUrl = requireEnv(env, 'DIRECT_URL');

  return {
    queue: {
      connectionString: directUrl,
      queues: [...WORKER_QUEUES],
      applicationName: env['WV2_QUEUE_APP_NAME'] ?? 'workerv2',
    },
    storage: {
      endpoint: requireEnv(env, 'R2_ENDPOINT'),
      region: env['R2_REGION'] ?? 'auto',
      accessKeyId: requireEnv(env, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv(env, 'R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv(env, 'R2_BUCKET_NAME'),
    },
    database: {
      connectionString: directUrl,
      maxConnections: parsePositiveInt(env['WV2_DB_MAX_CONNECTIONS'], 5, 'WV2_DB_MAX_CONNECTIONS'),
    },
    render: {
      // The app origin Chromium loads the print route from (default = local dev).
      appUrl: (env['APP_URL'] ?? 'http://localhost:3000').replace(/\/+$/, ''),
    },
    recovery: {
      enabled: env['WV2_RECOVERY'] !== 'off',
      intervalMs: parsePositiveInt(
        env['WV2_RECOVERY_INTERVAL_MS'],
        60_000,
        'WV2_RECOVERY_INTERVAL_MS',
      ),
      jitterMs: 15_000,
      batchSize: parsePositiveInt(env['WV2_RECOVERY_BATCH'], 100, 'WV2_RECOVERY_BATCH'),
      imageStalePendingMs: 5 * 60 * 1000,
      pdfStaleMs: 7 * 60 * 1000, // > a render's worst-case runtime, so the sweep never races a live render
      pdfMaxAttempts: 5,
      pdfTokenTtlMs: 5 * 60 * 1000,
    },
  };
}

/**
 * PROCESSOR CONFIGURATION — which job handlers the worker registers. Reserved for the phase that
 * introduces concrete processors; today it resolves to an empty set (no handlers), which is why the
 * worker stays idle. Separated from infra/runtime config so enabling a processor never touches
 * connection settings.
 */
export interface ProcessorConfig {
  /** Job types whose handlers should be registered. Empty in Phase I-0 (no processors exist yet). */
  readonly enabled: readonly string[];
}

/** Build the processor config from the environment. Phase I-0: always empty (no handlers to enable). */
export function loadProcessorConfig(
  _env: Readonly<Record<string, string | undefined>>,
): ProcessorConfig {
  return { enabled: [] };
}

/** Re-exported so infra callers can throw the same typed error as the rest of config. */
export { ConfigError };
