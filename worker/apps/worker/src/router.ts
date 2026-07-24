import type { Job, JobType } from './job.js';
import type { ProcessorRegistry } from './processors/registry.js';
import { NONE } from './recovery/cancellation.js';
import type { CancellationToken } from './recovery/cancellation.js';

/**
 * THE JOB ROUTER — the dispatch step that, for each job, resolves its `Processor` from the
 * `ProcessorRegistry` and runs it. It is deliberately thin: the registry owns resolution, the processor
 * owns the work, and the router owns only the "resolve-or-fail-loud" policy. A job whose `type` has no
 * registered processor raises `UnroutableJobError` rather than being silently dropped, so a
 * misconfigured deployment fails visibly instead of black-holing work.
 *
 * Flow: `QueueAdapter → JobRouter → ProcessorRegistry → Processor (→ Pipeline → Stages)`. The router
 * is pure (no I/O, no globals) and injected with a registry, so the Worker Runtime never changes as new
 * processors are added.
 */

/** Raised when a job arrives for a `type` that has no registered processor. */
export class UnroutableJobError extends Error {
  constructor(readonly jobType: JobType) {
    super(`No processor registered for job type "${jobType}"`);
    this.name = 'UnroutableJobError';
  }
}

export class JobRouter {
  constructor(private readonly registry: ProcessorRegistry) {}

  /** Resolve `job`'s processor and run it. Throws `UnroutableJobError` when none is registered. */
  async route(job: Job, cancellation: CancellationToken = NONE): Promise<void> {
    const processor = this.registry.resolve(job.type);
    if (processor === undefined) {
      throw new UnroutableJobError(job.type);
    }
    await processor.process(job, cancellation);
  }
}
