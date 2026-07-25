import type { JobType } from './job.js';

/**
 * ADAPTIVE CONCURRENCY — how many jobs of each type may run at once, and when intake must stop.
 *
 * WHY THIS EXISTS. Until Phase I-5 the consume loop was strictly sequential: `while (running) await
 * processOnce()`. That is a correct design and a terrible one under load, for two reasons the
 * validation suites make concrete:
 *
 *   1. HEAD-OF-LINE BLOCKING. A PDF render can take minutes. With concurrency 1, every queued image
 *      job waits behind it, even though image hardening and rendering contend for almost nothing.
 *   2. NO BACKPRESSURE. The loop pulled work as fast as the broker supplied it, with no regard for
 *      memory. Phase I-4 added a memory health probe; nothing consumed it. A worker could march
 *      straight into an OOM kill while reporting itself healthy right up to the last moment.
 *
 * THE MODEL: LANES WITH AN ADAPTIVE ALLOWANCE. Each job type owns a lane with a `min` and `max`. The
 * allowance actually granted moves between those bounds according to live pressure:
 *
 *      pressure = critical  →  0 for every lane        (intake stops; in-flight work finishes)
 *      pressure = elevated  →  halved, but never below `min`
 *      a HEAVY lane active  →  other lanes halved, but never below `min`
 *      otherwise            →  `max`
 *
 * `min` is what prevents the cure from being worse than the disease: a lane never drops to zero
 * through adaptation, only through critical memory pressure, so no job type can be starved out by a
 * busy neighbour. That directly encodes "reduce image concurrency while PDFs render, increase it
 * when Chromium is idle" without hardcoding anything about PDFs or Chromium — a lane declares
 * itself `heavy` because it monopolises an expensive shared resource, and a future GPU or OCR
 * processor gets the same behaviour by setting the same flag.
 *
 * WHAT THIS IS NOT. It is not a scheduler, a queue, or a work-stealing pool. It answers exactly one
 * question — "may another job of this type start right now?" — and the application's dispatch loop
 * does the rest. Keeping it a pure decision function is what makes every adaptation rule directly
 * unit-testable without a broker, a clock, or a running worker.
 */

/** Memory/CPU pressure, coarse on purpose: three states are actionable, a percentage is not. */
export type Pressure = 'normal' | 'elevated' | 'critical';

export interface LaneConfig {
  /** Floor the allowance never drops below through adaptation (starvation guard). */
  readonly min: number;
  /** Ceiling granted when the worker is unloaded. */
  readonly max: number;
  /**
   * This lane monopolises an expensive shared resource (Chromium today; a GPU or an OCR model
   * later). While any heavy lane is active, other lanes yield toward their `min`.
   */
  readonly heavy?: boolean;
}

export interface ConcurrencyConfig {
  /** Global ceiling across all lanes, whatever the per-lane maxima add up to. */
  readonly maxInFlight: number;
  /** Per-job-type lanes. A type with no entry uses `defaultLane`. */
  readonly lanes: Readonly<Record<JobType, LaneConfig>>;
  readonly defaultLane: LaneConfig;
  /**
   * Recovery is deferred while more than this fraction of the global budget is busy. Recovery is
   * background reconciliation: it must never compete with live customer work, but it also must not
   * be disabled, or a busy worker would never self-heal.
   */
  readonly recoveryQuietFraction: number;
}

export const DEFAULT_LANE: LaneConfig = { min: 1, max: 2 };

export interface ConcurrencyControllerDeps {
  readonly config: ConcurrencyConfig;
  /** Live pressure. Consulted through a short cache, so a hot dispatch loop cannot hammer it. */
  readonly pressure: () => Pressure;
  /** How long a pressure reading stays fresh (ms). */
  readonly pressureTtlMs?: number;
  readonly clock?: () => number;
}

/** A snapshot of the controller's decision state — for logs, metrics and `/diagnostics`. */
export interface ConcurrencySnapshot {
  readonly pressure: Pressure;
  readonly maxInFlight: number;
  readonly totalActive: number;
  readonly lanes: Readonly<Record<string, { active: number; allowance: number; max: number }>>;
  readonly admitting: readonly string[];
  readonly recoveryAllowed: boolean;
}

export class ConcurrencyController {
  private config: ConcurrencyConfig;
  private readonly pressureFn: () => Pressure;
  private readonly pressureTtlMs: number;
  private readonly clock: () => number;
  private readonly active = new Map<JobType, number>();
  private cachedPressure: Pressure = 'normal';
  private pressureReadAt = -Infinity;
  private totalActive = 0;

  constructor(deps: ConcurrencyControllerDeps) {
    this.config = deps.config;
    this.pressureFn = deps.pressure;
    this.pressureTtlMs = deps.pressureTtlMs ?? 250;
    this.clock = deps.clock ?? ((): number => Date.now());
  }

  /** Replace the configuration at runtime — concurrency stays operator-tunable without a restart. */
  reconfigure(update: Partial<ConcurrencyConfig>): void {
    this.config = { ...this.config, ...update };
  }

  get configuration(): ConcurrencyConfig {
    return this.config;
  }

  /** Current pressure, re-read at most once per TTL. */
  pressure(): Pressure {
    const now = this.clock();
    if (now - this.pressureReadAt >= this.pressureTtlMs) {
      try {
        this.cachedPressure = this.pressureFn();
      } catch {
        this.cachedPressure = 'normal'; // a broken sensor must not stop the worker
      }
      this.pressureReadAt = now;
    }
    return this.cachedPressure;
  }

  /** Whether any lane flagged `heavy` currently has work running. */
  private heavyActive(): boolean {
    for (const [type, count] of this.active) {
      if (count > 0 && this.laneFor(type).heavy === true) return true;
    }
    return false;
  }

  private laneFor(type: JobType): LaneConfig {
    return this.config.lanes[type] ?? this.config.defaultLane;
  }

  /** The allowance granted to `type` right now, after adaptation and the global ceiling. */
  allowanceFor(type: JobType): number {
    const lane = this.laneFor(type);
    const pressure = this.pressure();

    // Critical pressure stops intake completely. In-flight work is never cancelled — it is allowed
    // to finish and ack, which is what drains memory. Killing it would only cause a redelivery.
    if (pressure === 'critical') return 0;

    let allowance = lane.max;
    if (pressure === 'elevated') allowance = Math.max(lane.min, Math.floor(lane.max / 2));

    // Yield to a heavy lane — but the heavy lane does not yield to itself.
    if (lane.heavy !== true && this.heavyActive()) {
      allowance = Math.min(allowance, Math.max(lane.min, Math.floor(lane.max / 2)));
    }

    return Math.max(0, Math.min(allowance, this.config.maxInFlight));
  }

  /** Whether one more job of `type` may start. */
  admits(type: JobType): boolean {
    if (this.totalActive >= this.config.maxInFlight) return false;
    return (this.active.get(type) ?? 0) < this.allowanceFor(type);
  }

  /**
   * The job types that may start right now — passed straight to `QueueAdapter.poll(filter)` so a
   * full lane is never even asked for. An empty result means "do not poll at all", which is how
   * backpressure is expressed: the worker simply stops taking work.
   */
  eligibleTypes(known: readonly JobType[]): readonly JobType[] {
    return known.filter((type) => this.admits(type));
  }

  /** Record a job start. Callers MUST pair this with `release` in a `finally`. */
  acquire(type: JobType): void {
    this.active.set(type, (this.active.get(type) ?? 0) + 1);
    this.totalActive += 1;
  }

  /** Record a job finishing. */
  release(type: JobType): void {
    const current = this.active.get(type) ?? 0;
    if (current <= 1) this.active.delete(type);
    else this.active.set(type, current - 1);
    this.totalActive = Math.max(0, this.totalActive - 1);
  }

  get inFlight(): number {
    return this.totalActive;
  }

  activeOf(type: JobType): number {
    return this.active.get(type) ?? 0;
  }

  /**
   * Whether a recovery sweep may run now. Recovery is deferred — never cancelled — while the worker
   * is busy or under memory pressure, so self-healing resumes automatically the moment load drops.
   */
  allowRecovery(): boolean {
    if (this.pressure() !== 'normal') return false;
    return (
      this.totalActive <= Math.floor(this.config.maxInFlight * this.config.recoveryQuietFraction)
    );
  }

  /** Decision state, for structured logs, metrics and the diagnostics report. */
  snapshot(known: readonly JobType[] = []): ConcurrencySnapshot {
    const lanes: Record<string, { active: number; allowance: number; max: number }> = {};
    const types = new Set<JobType>([...known, ...this.active.keys()]);
    for (const type of types) {
      lanes[type] = {
        active: this.activeOf(type),
        allowance: this.allowanceFor(type),
        max: this.laneFor(type).max,
      };
    }
    return {
      pressure: this.pressure(),
      maxInFlight: this.config.maxInFlight,
      totalActive: this.totalActive,
      lanes,
      admitting: this.eligibleTypes([...types]),
      recoveryAllowed: this.allowRecovery(),
    };
  }
}

/**
 * Build the pressure sensor from RSS against the memory limits Phase I-4 already validates and
 * exposes. Reusing those exact thresholds is deliberate: the `memory` health probe and the
 * concurrency controller must agree, or the worker would report `degraded` while still accepting
 * work (or throttle while reporting itself healthy).
 */
export function memoryPressureSensor(
  softLimitBytes: number,
  hardLimitBytes: number,
  usage: () => NodeJS.MemoryUsage = (): NodeJS.MemoryUsage => process.memoryUsage(),
): () => Pressure {
  return (): Pressure => {
    const rss = usage().rss;
    if (rss >= hardLimitBytes) return 'critical';
    if (rss >= softLimitBytes) return 'elevated';
    return 'normal';
  };
}
