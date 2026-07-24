import type { Job } from '../job.js';
import type { JobExecution, JobRunner } from '../runner.js';
import type { JobRouter } from '../router.js';
import { NONE } from '../recovery/cancellation.js';
import type { CancellationToken } from '../recovery/cancellation.js';

/**
 * THE PROCESSOR JOB RUNNER — the `JobRunner` for the envelope path. It hands each polled `Job` to the
 * `JobRouter` (which resolves the processor from the registry and runs it). A resolved processor that
 * completes — including a handled-terminal outcome such as marking a photo rejected — resolves here, so
 * the consume loop ACKs. A retryable failure (or an unroutable type) rejects, so the loop NACKs and the
 * broker retries. This is the only glue between the generic worker lifecycle and the processor world.
 */
export class ProcessorJobRunner implements JobRunner<Job> {
  constructor(private readonly router: JobRouter) {}

  async run(job: Job, cancellation: CancellationToken = NONE): Promise<JobExecution> {
    await this.router.route(job, cancellation);
    return {
      ok: true,
      detail: {
        type: job.type,
        correlationId: job.metadata.correlationId,
        attempt: job.metadata.attempt,
      },
    };
  }
}
