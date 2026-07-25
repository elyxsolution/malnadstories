import {
  ConfigError,
  parseBoolean,
  parseIntInRange,
  parseUrl,
  requireEnv,
} from '../config-error.js';

/**
 * INFRASTRUCTURE CONFIGURATION — the external, injectable config for the production I/O adapters
 * (pg-boss queue, Cloudflare R2 object store, Supabase Postgres). It is kept ENTIRELY separate from
 * the runtime config, which selects the pure execution engine's durable storage — two orthogonal
 * concerns, two types.
 *
 * Infrastructure is STRICTLY OPT-IN: `loadInfrastructureConfig` returns `null` unless `WV2_INFRA` is
 * truthy (`on`/`true`/`1`/`yes`). With it off — the default, and every unit test — the worker builds
 * no adapters, opens no connections, and runs the in-memory reference path. With it on, EVERY
 * required variable is validated up front and any missing one FAILS FAST with the complete list, so
 * a half-configured worker never starts.
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

/** The composite infrastructure config. `null` when `WV2_INFRA` is not enabled. */
export interface InfrastructureConfig {
  readonly queue: QueueInfraConfig;
  readonly storage: StorageInfraConfig;
  readonly database: DatabaseInfraConfig;
  readonly render: RenderInfraConfig;
  readonly recovery: RecoveryInfraConfig;
}

/**
 * The variables production mode requires, each with the reason it exists. The PURPOSE is part of the
 * data because it is what turns "DIRECT_URL is missing" into an actionable message — an operator who
 * has never read this codebase can act on "Postgres SESSION connection (port 5432)".
 *
 * Only names and purposes ever appear in output. Values are never read into a message.
 */
const REQUIRED_INFRA_VARS: readonly { readonly name: string; readonly purpose: string }[] = [
  {
    name: 'DIRECT_URL',
    purpose: 'Postgres SESSION connection (port 5432) — pg-boss + the database',
  },
  {
    name: 'R2_ENDPOINT',
    purpose: 'Cloudflare R2 S3 endpoint (https://<account>.r2.cloudflarestorage.com)',
  },
  { name: 'R2_ACCESS_KEY_ID', purpose: 'Cloudflare R2 access key id' },
  { name: 'R2_SECRET_ACCESS_KEY', purpose: 'Cloudflare R2 secret access key' },
  { name: 'R2_BUCKET_NAME', purpose: 'Private R2 bucket the app uploads into' },
];

/** Whether infrastructure mode was ASKED for, independent of whether its variables are present. */
export function infrastructureRequested(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return parseBoolean(env['WV2_INFRA'], false, 'WV2_INFRA');
}

/** Required variables that are absent. Empty when production mode can start. */
export function missingInfrastructureVars(
  env: Readonly<Record<string, string | undefined>>,
): readonly { readonly name: string; readonly purpose: string }[] {
  return REQUIRED_INFRA_VARS.filter(({ name }) => (env[name] ?? '').trim().length === 0);
}

/**
 * Build the infrastructure config from the environment, or `null` when disabled.
 *
 * THE SWITCH accepts the usual truthy spellings (`on`/`true`/`1`/`yes`) via the same `parseBoolean`
 * that every other flag uses. It previously demanded the exact string `on`, which meant
 * `WV2_INFRA=true` silently produced a reference-mode worker — a healthy-looking process that
 * consumed nothing, with no diagnostic anywhere. Sharing one boolean convention across all flags is
 * both less surprising and strictly safer: an unrecognised value now RAISES rather than quietly
 * disabling production mode.
 *
 * VALIDATION reports EVERY missing variable at once. Reporting only the first turned configuring a
 * fresh deployment into a sequence of restart-and-discover cycles.
 */
export function loadInfrastructureConfig(
  env: Readonly<Record<string, string | undefined>>,
): InfrastructureConfig | null {
  if (!infrastructureRequested(env)) return null;

  const missing = missingInfrastructureVars(env);
  if (missing.length > 0) {
    const listed = missing.map((v) => `  • ${v.name.padEnd(22)} ${v.purpose}`).join('\n');
    throw new ConfigError(
      `WV2_INFRA is enabled, but ${missing.length} required variable(s) are not set:\n\n${listed}\n\n` +
        'Set them in the environment, or in worker/.env or the repo-root .env.local. ' +
        'See worker/.env.example.',
    );
  }

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
      // Bounded: an unbounded pool per worker silently exhausts Postgres' session limit once more
      // than a couple of workers run.
      maxConnections: parseIntInRange(
        env['WV2_DB_MAX_CONNECTIONS'],
        5,
        1,
        100,
        'WV2_DB_MAX_CONNECTIONS',
      ),
    },
    render: {
      // The app origin Chromium loads the print route from (default = local dev). Validated as an
      // absolute http(s) URL here, so a typo fails at boot rather than on the first PDF job.
      appUrl: parseUrl(env['APP_URL'], 'http://localhost:3000', 'APP_URL'),
    },
    recovery: {
      enabled: parseBoolean(env['WV2_RECOVERY'], true, 'WV2_RECOVERY'),
      intervalMs: parseIntInRange(
        env['WV2_RECOVERY_INTERVAL_MS'],
        60_000,
        1_000,
        3_600_000,
        'WV2_RECOVERY_INTERVAL_MS',
      ),
      jitterMs: parseIntInRange(
        env['WV2_RECOVERY_JITTER_MS'],
        15_000,
        0,
        600_000,
        'WV2_RECOVERY_JITTER_MS',
      ),
      batchSize: parseIntInRange(env['WV2_RECOVERY_BATCH'], 100, 1, 10_000, 'WV2_RECOVERY_BATCH'),
      imageStalePendingMs: parseIntInRange(
        env['WV2_RECOVERY_IMAGE_STALE_MS'],
        5 * 60 * 1000,
        30_000,
        86_400_000,
        'WV2_RECOVERY_IMAGE_STALE_MS',
      ),
      // Must exceed a render's worst-case runtime so the sweep never races a live render — the
      // relationship itself is asserted by `validateAppConfig`, not just the range.
      pdfStaleMs: parseIntInRange(
        env['WV2_RECOVERY_PDF_STALE_MS'],
        7 * 60 * 1000,
        60_000,
        86_400_000,
        'WV2_RECOVERY_PDF_STALE_MS',
      ),
      pdfMaxAttempts: parseIntInRange(
        env['WV2_RECOVERY_PDF_MAX_ATTEMPTS'],
        5,
        1,
        100,
        'WV2_RECOVERY_PDF_MAX_ATTEMPTS',
      ),
      pdfTokenTtlMs: parseIntInRange(
        env['WV2_RECOVERY_PDF_TOKEN_TTL_MS'],
        5 * 60 * 1000,
        60_000,
        3_600_000,
        'WV2_RECOVERY_PDF_TOKEN_TTL_MS',
      ),
    },
  };
}

/*
 * REMOVED: `ProcessorConfig` / `loadProcessorConfig`.
 *
 * That was a Phase I-0 placeholder which unconditionally returned `{ enabled: [] }` — it never read
 * its `env` argument and was never wired to anything. Because the startup log reported its length,
 * a fully working production worker with three registered processors still printed `processors: 0`,
 * which is precisely what made diagnosing reference-mode boots so confusing.
 *
 * Which processors run is not a configuration question at all: it is decided by what the composition
 * root registers in the `ProcessorRegistry`. The startup report now reads the registry directly, so
 * the number it prints is the number that actually exists.
 */

/** Re-exported so infra callers can throw the same typed error as the rest of config. */
export { ConfigError };
