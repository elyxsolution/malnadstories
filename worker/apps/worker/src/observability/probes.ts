import type { ComponentHealth, HealthProbe } from './health.js';
import { degraded, healthy, unhealthy } from './health.js';
import { errorMessage } from './model.js';

/**
 * THE CONCRETE HEALTH PROBES — one factory per subsystem the operator cares about.
 *
 * Every probe is defined against a MINIMAL STRUCTURAL type rather than the concrete adapter class
 * (`{ healthCheck(): Promise<'healthy' | 'unhealthy'> }` instead of `SupabasePostgresAdapter`).
 * That keeps this module free of infrastructure imports, makes each probe trivially fakeable, and
 * means a replaced adapter needs no probe change as long as it still reports its own health.
 *
 * The criticality assigned to each probe is the operational policy of this worker, stated once,
 * here — not scattered across whoever happens to call the health endpoint.
 */

// --- Infrastructure -----------------------------------------------------------------------------

/** Anything that can report binary connectivity — the shape all three I-0 adapters already expose. */
export interface BinaryHealthSource {
  healthCheck(): Promise<'healthy' | 'unhealthy'>;
}

/**
 * The database. READINESS-critical: every processor reads or writes Postgres, so a worker that
 * cannot reach it must stop accepting work — but it should NOT be restarted (the outage is
 * external, and a restart loop makes recovery slower, not faster).
 */
export function databaseProbe(database: BinaryHealthSource, ttlMs = 5_000): HealthProbe {
  return {
    name: 'database',
    criticality: 'readiness',
    ttlMs,
    check: async (): Promise<ComponentHealth> => binary(database, 'postgres unreachable'),
  };
}

/** The job broker. READINESS-critical: no queue, no work — but the process stays alive. */
export function queueProbe(queue: BinaryHealthSource, ttlMs = 5_000): HealthProbe {
  return {
    name: 'queue',
    criticality: 'readiness',
    ttlMs,
    check: async (): Promise<ComponentHealth> => binary(queue, 'pg-boss not connected'),
  };
}

/** Object storage (R2). READINESS-critical: both pipelines read/write objects. */
export function objectStoreProbe(store: BinaryHealthSource, ttlMs = 10_000): HealthProbe {
  return {
    name: 'storage',
    criticality: 'readiness',
    ttlMs,
    check: async (): Promise<ComponentHealth> => binary(store, 'bucket unreachable'),
  };
}

async function binary(source: BinaryHealthSource, failureDetail: string): Promise<ComponentHealth> {
  const state = await source.healthCheck();
  return state === 'healthy' ? healthy() : unhealthy(failureDetail);
}

// --- Chromium / long-lived resources ------------------------------------------------------------

/** The subset of `ResourceHandle` a probe needs. */
export interface ResourceHealthSource {
  health(): Promise<'healthy' | 'unhealthy' | 'absent'>;
}

/**
 * Chromium. The canonical GRACEFUL-DEGRADATION case, and the reason `degraded` is not `unhealthy`:
 *
 *   Chromium unavailable → the worker is alive → the PDF processor is temporarily unavailable →
 *   readiness is DEGRADED, not dead. Image hardening and cleanup keep running untouched.
 *
 * `absent` is explicitly HEALTHY: the browser is created lazily on the first PDF job, so "not yet
 * launched" is the normal steady state of a worker that has only processed images. Reporting that
 * as degraded would make a perfectly healthy worker look broken.
 */
export function chromiumProbe(browser: ResourceHealthSource, ttlMs = 5_000): HealthProbe {
  return {
    name: 'chromium',
    criticality: 'readiness',
    ttlMs,
    check: async (): Promise<ComponentHealth> => {
      const state = await browser.health();
      if (state === 'healthy') return healthy({ state });
      if (state === 'absent') return healthy({ state, note: 'not launched yet (lazy)' });
      return degraded(
        'chromium unhealthy — PDF rendering unavailable, other processors unaffected',
        {
          state,
        },
      );
    },
  };
}

/** Reports how many long-lived resources are registered/live. */
export interface ResourceManagerStats {
  readonly registered: number;
  readonly live: number;
}

/** The Resource Manager itself. Informational — counts, for diagnosis. */
export function resourceManagerProbe(stats: () => ResourceManagerStats): HealthProbe {
  return {
    name: 'resource-manager',
    criticality: 'informational',
    ttlMs: 1_000,
    check: (): ComponentHealth => healthy({ ...stats() }),
  };
}

// --- Recovery ------------------------------------------------------------------------------------

/** The scheduler state a probe needs (see `PeriodicScheduler.stats`). */
export interface SchedulerStats {
  readonly running: boolean;
  readonly consecutiveFailures: number;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

/**
 * The recovery scheduler. INFORMATIONAL by design: recovery is a background self-healing sweep, so
 * its failure must never stop the worker from processing live jobs. Repeated failures surface as
 * `degraded` so an operator notices the backlog will grow, but processors continue regardless.
 */
export function recoverySchedulerProbe(
  stats: () => SchedulerStats,
  degradeAfterFailures = 3,
): HealthProbe {
  return {
    name: 'recovery-scheduler',
    criticality: 'informational',
    ttlMs: 1_000,
    check: (): ComponentHealth => {
      const current = stats();
      const data: Record<string, unknown> = {
        running: current.running,
        consecutiveFailures: current.consecutiveFailures,
        lastRunAt: current.lastRunAt,
      };
      if (!current.running) return healthy({ ...data, note: 'recovery disabled' });
      if (current.consecutiveFailures >= degradeAfterFailures) {
        return degraded(
          `recovery sweep failing (${current.consecutiveFailures} consecutive) — processing unaffected`,
          { ...data, lastError: current.lastError },
        );
      }
      return healthy(data);
    },
  };
}

// --- Process resources ---------------------------------------------------------------------------

export interface MemoryThresholds {
  /** Report `degraded` above this RSS (bytes). */
  readonly softLimitBytes: number;
  /** Report `unhealthy` above this RSS (bytes) — the worker stops accepting new work. */
  readonly hardLimitBytes: number;
}

/**
 * Process memory. READINESS-critical with a two-stage threshold: a worker approaching its container
 * limit should stop pulling new jobs (back-pressure) so the in-flight one can finish and be acked,
 * rather than being OOM-killed mid-job and losing the work. Liveness stays true — the process is
 * running fine; it just should not be handed more.
 */
export function memoryProbe(
  thresholds: MemoryThresholds,
  usage: () => NodeJS.MemoryUsage = (): NodeJS.MemoryUsage => process.memoryUsage(),
): HealthProbe {
  return {
    name: 'memory',
    criticality: 'readiness',
    ttlMs: 1_000,
    check: (): ComponentHealth => {
      const mem = usage();
      const data = {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        softLimitBytes: thresholds.softLimitBytes,
        hardLimitBytes: thresholds.hardLimitBytes,
      };
      if (mem.rss >= thresholds.hardLimitBytes) {
        return unhealthy('memory above hard limit — refusing new work', data);
      }
      if (mem.rss >= thresholds.softLimitBytes) {
        return degraded('memory above soft limit', data);
      }
      return healthy(data);
    },
  };
}

/** CPU utilisation, sampled by the runtime monitor. Informational — high CPU is normal here. */
export function cpuProbe(
  sample: () => { userPercent: number; systemPercent: number } | null,
  degradeAbovePercent = 95,
): HealthProbe {
  return {
    name: 'cpu',
    criticality: 'informational',
    ttlMs: 1_000,
    check: (): ComponentHealth => {
      const current = sample();
      if (current === null) return healthy({ note: 'no sample yet' });
      const total = current.userPercent + current.systemPercent;
      const data = { ...current, totalPercent: Number(total.toFixed(2)) };
      return total >= degradeAbovePercent ? degraded('sustained high CPU', data) : healthy(data);
    },
  };
}

// --- Configuration + runtime ----------------------------------------------------------------------

/**
 * Configuration. Informational at RUNTIME because invalid configuration can never reach this point
 * — startup fails fast on it (see `startup.ts`). The probe exists so `/ready` and `/diagnostics`
 * still show WHICH configuration the running process resolved, plus any non-fatal warnings.
 */
export function configurationProbe(
  summary: () => Record<string, unknown>,
  warnings: readonly string[] = [],
): HealthProbe {
  return {
    name: 'configuration',
    criticality: 'informational',
    ttlMs: 60_000, // config cannot change without a restart
    check: (): ComponentHealth =>
      warnings.length === 0
        ? healthy(summary())
        : degraded(`${warnings.length} configuration warning(s)`, { ...summary(), warnings }),
  };
}

/** The Worker Runtime's own dependency health (durable storage + image backend). */
export interface RuntimeHealthSource {
  health(): {
    readonly live: boolean;
    readonly ready: boolean;
    readonly dependencies: readonly { name: string; state: string; detail?: string }[];
  };
}

/**
 * The execution runtime's durable storage. LIVENESS-critical: if the worker cannot persist its own
 * journal/artifacts, restarting is genuinely the right remedy (a bad mount, a full disk) — unlike
 * an external outage, this is usually local and recoverable by a restart.
 */
export function runtimeStorageProbe(runtime: RuntimeHealthSource): HealthProbe {
  return {
    name: 'runtime-storage',
    criticality: 'liveness',
    ttlMs: 2_000,
    check: (): ComponentHealth => {
      try {
        const report = runtime.health();
        const storage = report.dependencies.find((d) => d.name === 'storage');
        const state = storage?.state ?? 'unknown';
        if (state === 'healthy') return healthy({ state });
        return unhealthy(storage?.detail ?? `durable storage ${state}`, { state });
      } catch (error) {
        return unhealthy(errorMessage(error));
      }
    },
  };
}

/** The processor registry — proves the worker can actually route the job types it declares. */
export function processorsProbe(types: () => readonly string[]): HealthProbe {
  return {
    name: 'processors',
    criticality: 'readiness',
    ttlMs: 60_000,
    check: (): ComponentHealth => {
      const registered = types();
      return registered.length === 0
        ? degraded('no processors registered — the worker can accept no work', { registered })
        : healthy({ registered });
    },
  };
}

/**
 * QUEUE COVERAGE — which queues the application enqueues onto that NO processor serves.
 *
 * This exists because of a real gap found during production certification: the app enqueues
 * `cover-thumbnail` and `blueprint-thumbnail`, and Worker V2 implements neither. Such jobs are not
 * lost — pg-boss holds them durably and the poll filter never takes them — but they accumulate
 * silently and the feature they back simply never happens. Silence is the danger here, so the gap
 * is surfaced continuously rather than being left to a code reading.
 *
 * `degraded`, not `unhealthy`: an unserved queue does not make this worker unfit for the work it
 * DOES serve, and pulling it from rotation would stop image and PDF processing for no reason.
 */
export function queueCoverageProbe(
  declared: () => readonly string[],
  served: () => readonly string[],
): HealthProbe {
  return {
    name: 'queue-coverage',
    criticality: 'informational',
    ttlMs: 60_000,
    check: (): ComponentHealth => {
      const servedTypes = served();
      const unserved = declared().filter((queue) => !servedTypes.includes(queue));
      if (unserved.length === 0) return healthy({ served: servedTypes });
      return degraded(
        `${unserved.length} queue(s) have no processor — jobs accumulate undelivered`,
        { unserved, served: servedTypes },
      );
    },
  };
}
