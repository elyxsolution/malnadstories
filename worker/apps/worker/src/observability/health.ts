import type { HealthStatus } from '@workerv2/health';
import { STATUS_SEVERITY, worseStatus } from '@workerv2/health';
import { errorMessage } from './model.js';

/**
 * THE HEALTH SYSTEM — generalized, per-component health with a real liveness/readiness split.
 *
 * REUSE: the three-valued `HealthStatus` (`healthy` | `degraded` | `unhealthy`), its severity
 * ordering, and the `worseStatus` fold all come from the foundation's `@workerv2/health`. What that
 * package deliberately does not model — and what an operator actually needs — is added here:
 *
 *   • CRITICALITY. A component declares what its failure MEANS, which is the whole liveness vs.
 *     readiness distinction. Chromium being down must not restart the worker (image jobs are still
 *     being processed perfectly well); the database being down must stop it accepting work.
 *   • CACHING. Orchestrators probe every few seconds. Without a TTL, `/ready` would run a Postgres
 *     round-trip and an R2 HEAD on every probe — an availability risk created BY the health check.
 *     Each component's result is cached for its own TTL.
 *   • TOTALITY. A probe that throws, hangs, or returns nonsense yields `unhealthy` with a reason,
 *     never an exception out of the report. Health reporting can never itself take the worker down.
 *
 * Health is OBSERVATIONAL: nothing here influences execution. It reads state that already exists.
 */

export type { HealthStatus };

/**
 * What a component's failure means for the process:
 *
 *   • `liveness`      — the process cannot function; a supervisor should restart it.
 *   • `readiness`     — the process is fine but should not be given (certain) new work.
 *   • `informational` — reported for diagnosis; affects the overall status but neither probe.
 */
export type Criticality = 'liveness' | 'readiness' | 'informational';

/** The outcome of probing one component. */
export interface ComponentHealth {
  readonly status: HealthStatus;
  /** Short operator-facing reason. Sanitized — never secrets. */
  readonly detail?: string;
  /** Small JSON-safe diagnostic bag (counts, thresholds, ids). */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** A named component probe. `check` must be cheap; expensive probes must set a generous `ttlMs`. */
export interface HealthProbe {
  readonly name: string;
  readonly criticality: Criticality;
  /** How long a result stays fresh. `0` disables caching. Default 5s. */
  readonly ttlMs?: number;
  check(): Promise<ComponentHealth> | ComponentHealth;
}

/** One component's entry in a report. */
export interface ComponentReport extends ComponentHealth {
  readonly name: string;
  readonly criticality: Criticality;
  /** How long the probe took (ms); `0` when served from cache. */
  readonly durationMs: number;
  /** Whether this entry came from the TTL cache rather than a fresh probe. */
  readonly cached: boolean;
}

/** The aggregate health of the worker. */
export interface WorkerHealthReport {
  /** Worst status across every component (empty registry ⇒ `healthy`). */
  readonly status: HealthStatus;
  /** Can the worker continue running? `false` ⇒ a supervisor should restart it. */
  readonly live: boolean;
  /** Can the worker safely accept more work? */
  readonly ready: boolean;
  readonly components: readonly ComponentReport[];
  readonly checkedAt: string;
}

interface CacheEntry {
  readonly report: ComponentReport;
  readonly expiresAt: number;
}

const DEFAULT_TTL_MS = 5_000;

/**
 * The registry of component probes + the aggregation rules. One instance per worker; probes are
 * registered at composition time by whichever subsystem owns the component.
 */
export class WorkerHealthRegistry {
  private readonly probes = new Map<string, HealthProbe>();
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** Register (or replace) a probe by name. Returns `this` for composition-time chaining. */
  register(probe: HealthProbe): this {
    this.probes.set(probe.name, probe);
    this.cache.delete(probe.name);
    return this;
  }

  /** Remove a probe (e.g. a subsystem that was never enabled). */
  unregister(name: string): boolean {
    this.cache.delete(name);
    return this.probes.delete(name);
  }

  /** Registered probe names, sorted — used by the diagnostics report. */
  get names(): readonly string[] {
    return [...this.probes.keys()].sort();
  }

  /** Drop every cached result so the next report re-probes (the manual "run checks now" path). */
  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Probe every component (in parallel, honouring each one's TTL cache) and aggregate.
   *
   * Aggregation rules:
   *   • `status` = the worst component status.
   *   • `live`   = no `liveness` component is `unhealthy`.
   *   • `ready`  = live AND no `readiness` component is `unhealthy`.
   *
   * Note the asymmetry that makes the Chromium example work: a `degraded` readiness component
   * lowers the reported STATUS but does not clear the readiness FLAG. The worker keeps taking work
   * — some of it may fail over to another capability — rather than being pulled out of rotation
   * because one optional subsystem is impaired.
   */
  async report(): Promise<WorkerHealthReport> {
    const components = await Promise.all([...this.probes.values()].map((p) => this.runProbe(p)));
    components.sort((a, b) => a.name.localeCompare(b.name)); // stable output for humans + tests

    const status = components.reduce<HealthStatus>(
      (acc, c) => worseStatus(acc, c.status),
      'healthy',
    );
    const live = !components.some((c) => c.criticality === 'liveness' && c.status === 'unhealthy');
    const ready =
      live && !components.some((c) => c.criticality === 'readiness' && c.status === 'unhealthy');

    return {
      status,
      live,
      ready,
      components,
      checkedAt: new Date(this.clock()).toISOString(),
    };
  }

  private async runProbe(probe: HealthProbe): Promise<ComponentReport> {
    const now = this.clock();
    const cached = this.cache.get(probe.name);
    if (cached !== undefined && cached.expiresAt > now) {
      return { ...cached.report, durationMs: 0, cached: true };
    }

    const started = now;
    let health: ComponentHealth;
    try {
      health = await probe.check();
    } catch (error) {
      // A probe must never propagate. An exception IS the unhealthy signal.
      health = { status: 'unhealthy', detail: errorMessage(error) };
    }

    const report: ComponentReport = {
      name: probe.name,
      criticality: probe.criticality,
      status: health.status,
      ...(health.detail === undefined ? {} : { detail: health.detail }),
      ...(health.data === undefined ? {} : { data: health.data }),
      durationMs: Math.max(0, this.clock() - started),
      cached: false,
    };

    const ttl = probe.ttlMs ?? DEFAULT_TTL_MS;
    if (ttl > 0) this.cache.set(probe.name, { report, expiresAt: this.clock() + ttl });
    return report;
  }
}

/** Numeric encoding of a status, for the `worker.health.component_status` gauge. */
export function statusValue(status: HealthStatus): number {
  return STATUS_SEVERITY[status];
}

/** Convenience constructors that keep probe bodies to a single expression. */
export const HEALTHY: ComponentHealth = { status: 'healthy' };
export function degraded(detail: string, data?: Record<string, unknown>): ComponentHealth {
  return { status: 'degraded', detail, ...(data === undefined ? {} : { data }) };
}
export function unhealthy(detail: string, data?: Record<string, unknown>): ComponentHealth {
  return { status: 'unhealthy', detail, ...(data === undefined ? {} : { data }) };
}
export function healthy(data?: Record<string, unknown>): ComponentHealth {
  return data === undefined ? HEALTHY : { status: 'healthy', data };
}
