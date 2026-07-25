import type { AppConfig } from './config.js';
import { ConfigError } from './config-error.js';

/**
 * CENTRALIZED CONFIGURATION VALIDATION.
 *
 * Configuration is validated in two complementary passes, and this module owns the second:
 *
 *   1. PER-FIELD, at parse time (`config-error.ts` helpers) — is this env var an integer in range,
 *      a valid URL, a known enum member? A bad value throws where it is read, naming the variable.
 *   2. CROSS-FIELD, here — do the resolved values make SENSE TOGETHER? These are the failures that
 *      per-field parsing structurally cannot catch, and they are exactly the ones that produce
 *      baffling production behaviour rather than an obvious crash:
 *
 *        • a PDF stale-threshold shorter than a render's own timeout ⇒ the recovery sweep re-drives
 *          renders that are still legitimately running, doubling Chromium load under stress;
 *        • a soft memory limit above the hard limit ⇒ the `degraded` warning never fires and the
 *          worker jumps straight from healthy to refusing work;
 *        • a recovery interval shorter than the batch it must process ⇒ sweeps queue behind each
 *          other forever.
 *
 * The pass returns ISSUES rather than throwing, so `error`s and `warning`s can be reported
 * together — an operator sees every problem at once instead of fixing them one restart at a time.
 * Errors reject the configuration at startup; warnings are surfaced by the `configuration` health
 * probe and the startup report, and the worker runs.
 */

export type ConfigIssueSeverity = 'error' | 'warning';

export interface ConfigIssue {
  /** The setting (or pair of settings) at fault, named as the operator configures it. */
  readonly field: string;
  readonly message: string;
  readonly severity: ConfigIssueSeverity;
}

function error(field: string, message: string): ConfigIssue {
  return { field, message, severity: 'error' };
}
function warning(field: string, message: string): ConfigIssue {
  return { field, message, severity: 'warning' };
}

/**
 * A PDF render's own worst-case budget (navigation + readiness + settle + pdf), from
 * `DEFAULT_RENDER_TIMEOUTS`. Duplicated as a constant rather than imported because the renderer
 * lives behind the lazily-loaded processor chunk, and configuration must validate without pulling
 * Puppeteer into the default boot path.
 */
const WORST_CASE_RENDER_MS = 60_000 + 60_000 + 5_000 + 60_000;

/** Run every cross-field rule. Pure — no I/O, no env access, no throwing. */
export function validateAppConfig(config: AppConfig): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { app, concurrency, observability, infrastructure, runtime } = config;

  // --- Concurrency lanes ---------------------------------------------------------------------------
  for (const [type, lane] of Object.entries(concurrency.lanes)) {
    if (lane.min > lane.max) {
      issues.push(
        error(
          `lane:${type}`,
          `minimum concurrency (${lane.min}) exceeds the maximum (${lane.max})`,
        ),
      );
    }
    if (lane.min > concurrency.maxInFlight) {
      // The lane floor could never be honoured, so the starvation guard would silently not apply.
      issues.push(
        error(
          `lane:${type}`,
          `minimum concurrency (${lane.min}) exceeds WV2_MAX_IN_FLIGHT (${concurrency.maxInFlight})`,
        ),
      );
    }
  }
  const floors = Object.values(concurrency.lanes).reduce((sum, lane) => sum + lane.min, 0);
  if (floors > concurrency.maxInFlight) {
    issues.push(
      warning(
        'WV2_MAX_IN_FLIGHT',
        `lane minimums total ${floors}, above the global ceiling of ${concurrency.maxInFlight} — some lane will be squeezed below its floor`,
      ),
    );
  }

  // --- Shutdown ------------------------------------------------------------------------------------
  if (app.drainTimeoutMs < app.pollIntervalMs) {
    issues.push(
      warning(
        'WV2_DRAIN_TIMEOUT_MS',
        'drain timeout is shorter than the poll interval — shutdown may abandon work it could have finished',
      ),
    );
  }

  // --- Memory limits -----------------------------------------------------------------------------
  if (observability.memorySoftLimitBytes >= observability.memoryHardLimitBytes) {
    issues.push(
      error(
        'WV2_MEMORY_SOFT_LIMIT_MB',
        'soft memory limit must be below the hard limit, otherwise the degraded warning never fires',
      ),
    );
  }

  // --- Sampling ----------------------------------------------------------------------------------
  if (observability.tracing && observability.traceSampleRatio === 0) {
    issues.push(
      warning(
        'WV2_TRACE_SAMPLE',
        'tracing is enabled but the sample ratio is 0 — no traces will be recorded',
      ),
    );
  }

  // --- Polling + monitoring cadence ---------------------------------------------------------------
  if (app.pollIntervalMs > 60_000) {
    issues.push(
      warning(
        'WV2_POLL_INTERVAL_MS',
        `idle poll interval of ${app.pollIntervalMs}ms delays new work by up to that long`,
      ),
    );
  }
  if (observability.monitorIntervalMs < app.pollIntervalMs) {
    issues.push(
      warning(
        'WV2_MONITOR_INTERVAL_MS',
        'resource sampling is more frequent than job polling — sampling cost may dominate an idle worker',
      ),
    );
  }

  // --- Durable storage ----------------------------------------------------------------------------
  if (runtime.storage.kind === 'memory' && infrastructure !== null) {
    issues.push(
      warning(
        'WV2_STORAGE',
        'infrastructure is enabled but runtime storage is in-memory — restart recovery will find no runs',
      ),
    );
  }

  if (infrastructure === null) return issues;

  // --- Recovery thresholds -------------------------------------------------------------------------
  const recovery = infrastructure.recovery;
  if (recovery.enabled) {
    if (recovery.pdfStaleMs <= WORST_CASE_RENDER_MS) {
      issues.push(
        error(
          'WV2_RECOVERY_PDF_STALE_MS',
          `must exceed a render's worst-case runtime (${WORST_CASE_RENDER_MS}ms), or the sweep will re-drive live renders`,
        ),
      );
    }
    if (recovery.intervalMs <= recovery.jitterMs) {
      issues.push(
        warning(
          'WV2_RECOVERY_INTERVAL_MS',
          'jitter is as large as the interval — sweep timing will be highly irregular',
        ),
      );
    }
    if (recovery.batchSize > 1_000) {
      issues.push(
        warning(
          'WV2_RECOVERY_BATCH',
          `batch of ${recovery.batchSize} may make a single sweep long-running; recovery is meant to be bounded`,
        ),
      );
    }
    if (recovery.pdfMaxAttempts < 1) {
      issues.push(error('WV2_RECOVERY_PDF_MAX_ATTEMPTS', 'must allow at least one attempt'));
    }
    if (recovery.pdfTokenTtlMs <= WORST_CASE_RENDER_MS) {
      issues.push(
        warning(
          'WV2_RECOVERY_PDF_TOKEN_TTL_MS',
          'print-token TTL is shorter than a worst-case render — a re-driven render may expire mid-flight',
        ),
      );
    }
  }

  // --- Connections --------------------------------------------------------------------------------
  if (infrastructure.database.maxConnections > 20) {
    issues.push(
      warning(
        'WV2_DB_MAX_CONNECTIONS',
        `${infrastructure.database.maxConnections} connections per worker can exhaust the Postgres session pool when several workers run`,
      ),
    );
  }

  return issues;
}

/**
 * Reject an invalid configuration and return the non-fatal warnings.
 *
 * Called from `loadAppConfig`, so an invalid configuration can never reach a running worker: a
 * misconfigured deployment fails at boot with every problem listed, rather than half-starting.
 */
export function assertConfigValid(config: AppConfig): readonly string[] {
  const issues = validateAppConfig(config);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    const detail = errors.map((i) => `  • ${i.field}: ${i.message}`).join('\n');
    throw new ConfigError(`invalid configuration:\n${detail}`);
  }
  return issues.map((i) => `${i.field}: ${i.message}`);
}
