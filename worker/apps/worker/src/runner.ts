import type { WorkerRuntime } from '@workerv2/worker-runtime';
import type { WorkerJob } from './queue.js';
import type { CancellationToken } from './recovery/cancellation.js';

/**
 * THE JOB RUNNER — the strategy that decides HOW a polled job is executed, decoupled from the worker
 * lifecycle (start / recover / health / drain / shutdown), which is identical regardless of job kind.
 * `WorkerApplication` owns the lifecycle + consume loop and delegates execution to an injected runner,
 * so the same application drives BOTH the legacy album-render path (a Blueprint → `WorkerRuntime.run`)
 * and the new envelope path (a `Job` → router → registry → processor) without duplicating any of the
 * lifecycle machinery. The Worker Runtime itself is never modified.
 *
 * Contract: `run` resolves for a completed (or handled-terminal) job — the loop ACKs it — and rejects
 * ONLY for a retryable failure — the loop NACKs it (broker retry).
 */

/** The result of running one job: whether it succeeded + a small detail bag for the structured log. */
export interface JobExecution {
  readonly ok: boolean;
  readonly detail: Record<string, unknown>;
}

export interface JobRunner<TJob> {
  run(job: TJob, cancellation?: CancellationToken): Promise<JobExecution>;
}

/**
 * The legacy runner: executes an album `Blueprint` through the unchanged `WorkerRuntime` (Coordinator +
 * durable journal + content-addressed artifacts). Used by the default in-memory path and its tests; the
 * runtime is not modified.
 */
export class BlueprintJobRunner implements JobRunner<WorkerJob> {
  constructor(private readonly runtime: WorkerRuntime) {}

  async run(job: WorkerJob): Promise<JobExecution> {
    const { result } = await this.runtime.run(job.blueprint);
    return {
      ok: result.succeeded,
      detail: { succeeded: result.succeeded, pdf: result.pdfKey ?? null },
    };
  }
}
