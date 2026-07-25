/**
 * THE CHAOS FRAMEWORK — controlled, deterministic fault injection.
 *
 * DESIGN CONSTRAINT, and the reason this is a separate module rather than flags inside the adapters:
 * production code must be completely unaware that chaos exists. So faults are injected by WRAPPING
 * the existing ports (`ObjectStore`, `DatabaseAdapter`, `PageRenderer`, `QueueAdapter`) in
 * decorators. The worker is handed something that satisfies the same interface and cannot tell the
 * difference — no `if (chaosEnabled)` ever reaches a processor, and with chaos disabled the
 * decorators are pass-through.
 *
 * DETERMINISM. `intermittent` uses an injectable counter rather than `Math.random`, so a failing
 * chaos test reproduces exactly. Randomised chaos finds bugs once and then can never prove they are
 * fixed; deterministic chaos becomes a regression test.
 */

/** What a fault does when it fires. */
export type FaultKind =
  /** Reject immediately — the dependency is down (connection refused). */
  | 'outage'
  /** Succeed, but only after `delayMs` — a degraded dependency, the one that causes timeouts. */
  | 'slow'
  /** Never settle within the caller's patience — models a hung socket. */
  | 'timeout'
  /** Reject with a crash-shaped error — Chromium `Target closed`, a killed connection. */
  | 'crash'
  /** Reject with an allocation failure — the OOM path. */
  | 'oom';

export interface FaultSpec {
  readonly kind: FaultKind;
  /** Delay applied by `slow` (ms). */
  readonly delayMs?: number;
  /**
   * Fire on every Nth call (1 = every call). Deterministic by construction, so a discovered failure
   * is reproducible.
   */
  readonly everyNthCall?: number;
  /** Stop firing after this many activations; unset = unlimited. */
  readonly maxOccurrences?: number;
  /** Restrict the fault to operations whose name matches (e.g. only `read`, only `write`). */
  readonly operations?: readonly string[];
  /** Message carried by the injected error. */
  readonly message?: string;
}

/** Raised by an injected fault, so tests can distinguish chaos from a genuine bug. */
export class InjectedFault extends Error {
  constructor(
    readonly kind: FaultKind,
    readonly target: string,
    readonly operation: string,
    message: string,
  ) {
    super(message);
    this.name = 'InjectedFault';
  }
}

interface FaultState {
  readonly spec: FaultSpec;
  calls: number;
  fired: number;
}

/**
 * Owns which faults are armed. One controller is shared by every decorator, so a scenario can be
 * described in one place ("R2 is down AND the database is slow") and torn down in one call.
 *
 * With nothing armed, `intercept` returns immediately and the decorators add a single map lookup —
 * which is why leaving the wrappers in place in a test harness costs nothing measurable.
 */
export class FaultController {
  private readonly faults = new Map<string, FaultState>();

  /** Arm a fault on `target` (e.g. `storage`, `database`, `renderer`, `queue`). */
  arm(target: string, spec: FaultSpec): this {
    this.faults.set(target, { spec, calls: 0, fired: 0 });
    return this;
  }

  /** Disarm one target. */
  disarm(target: string): this {
    this.faults.delete(target);
    return this;
  }

  /** Disarm everything — the "heal the system" step every chaos test needs. */
  healAll(): this {
    this.faults.clear();
    return this;
  }

  /** Whether any fault is armed (the fast path check). */
  get armed(): boolean {
    return this.faults.size > 0;
  }

  /** How many times the fault on `target` actually fired. */
  occurrences(target: string): number {
    return this.faults.get(target)?.fired ?? 0;
  }

  /**
   * Called by a decorator before it delegates. Applies the armed fault for `target`/`operation`, or
   * returns immediately when nothing is armed.
   */
  async intercept(target: string, operation: string): Promise<void> {
    const state = this.faults.get(target);
    if (state === undefined) return;

    const { spec } = state;
    if (spec.operations !== undefined && !spec.operations.includes(operation)) return;

    state.calls += 1;
    const every = spec.everyNthCall ?? 1;
    if (state.calls % every !== 0) return;
    if (spec.maxOccurrences !== undefined && state.fired >= spec.maxOccurrences) return;
    state.fired += 1;

    const message = spec.message ?? `${target}.${operation} — injected ${spec.kind}`;
    switch (spec.kind) {
      case 'outage':
        throw new InjectedFault('outage', target, operation, message);
      case 'crash':
        throw new InjectedFault('crash', target, operation, message);
      case 'oom':
        throw new InjectedFault(
          'oom',
          target,
          operation,
          spec.message ?? 'Allocation failed - JavaScript heap out of memory',
        );
      case 'slow':
        await delay(spec.delayMs ?? 50);
        return;
      case 'timeout':
        // Long enough that any realistic caller timeout fires first, but still bounded so a test can
        // never actually hang if something goes wrong with the timeout under test.
        await delay(spec.delayMs ?? 60_000);
        throw new InjectedFault('timeout', target, operation, `${message} (timed out)`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The always-disabled controller: production composition can pass this and pay nothing. */
export const NO_FAULTS = new FaultController();
