/**
 * The WORKER LIFECYCLE — a tiny state machine for the runtime's operational phases: `idle` →
 * `starting` → `running` → `draining` → `stopped` (and a terminal `failed`). It tracks in-flight
 * runs so GRACEFUL SHUTDOWN can drain them before stopping. It is orchestration-free: it holds no
 * processing state, makes no execution decisions, and never touches the Coordinator — it only
 * models the runtime's own lifecycle.
 */

export type LifecyclePhase = 'idle' | 'starting' | 'running' | 'draining' | 'stopped' | 'failed';

export class WorkerLifecycle {
  private current: LifecyclePhase = 'idle';
  private inFlight = 0;

  get phase(): LifecyclePhase {
    return this.current;
  }

  /** Live = the process is up and not stopped/failed. */
  get live(): boolean {
    return this.current !== 'stopped' && this.current !== 'failed';
  }

  /** Ready = fully started and accepting work. */
  get running(): boolean {
    return this.current === 'running';
  }

  get inFlightCount(): number {
    return this.inFlight;
  }

  /** Begin startup. */
  starting(): void {
    this.transition('idle', 'starting');
  }

  /** Mark the runtime started + accepting work. */
  started(): void {
    this.transition('starting', 'running');
  }

  /** Mark a run in flight (rejected once draining/stopped). */
  beginRun(): void {
    if (this.current !== 'running') {
      throw new Error(`Runtime not accepting work (phase: ${this.current})`);
    }
    this.inFlight += 1;
  }

  /** Mark a run finished. */
  endRun(): void {
    if (this.inFlight > 0) this.inFlight -= 1;
  }

  /** Begin graceful shutdown: stop accepting new work; existing work drains. */
  drain(): void {
    if (this.current === 'running') this.current = 'draining';
  }

  /** Complete shutdown once drained (throws if work is still in flight). */
  stop(): void {
    if (this.inFlight > 0) {
      throw new Error(`Cannot stop with ${this.inFlight} run(s) in flight`);
    }
    this.current = 'stopped';
  }

  /** Mark the runtime failed (terminal). */
  fail(): void {
    this.current = 'failed';
  }

  private transition(from: LifecyclePhase, to: LifecyclePhase): void {
    if (this.current !== from) {
      throw new Error(
        `Illegal lifecycle transition ${this.current} → ${to} (expected from ${from})`,
      );
    }
    this.current = to;
  }
}
