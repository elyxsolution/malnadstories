import type { Job, JobType } from '../job.js';
import type { CancellationToken } from '../recovery/cancellation.js';

/**
 * THE PROCESSOR REGISTRY — the generic, dependency-injected map from a job `type` to the `Processor`
 * that handles it. It is the seam that lets every future job kind (image-hardening today; PDF, cleanup,
 * watermarking, AI analysis, extra export formats later) be added by REGISTERING a processor — never by
 * editing the Worker Runtime, the consume loop, or the router. The registry holds no infrastructure and
 * no global state: one instance is composed per worker and injected.
 *
 * A `Processor` captures its own dependencies at construction (so `process` takes only the job); the
 * registry neither knows nor cares what a processor does internally. This keeps the runtime generic and
 * makes each processor independently testable.
 */

/** Raised when two processors claim the same `type` (a composition-time bug). */
export class DuplicateProcessorError extends Error {
  constructor(readonly jobType: JobType) {
    super(`A processor is already registered for job type "${jobType}"`);
    this.name = 'DuplicateProcessorError';
  }
}

/**
 * A unit of work for one job `type`. Its dependencies are injected at construction, so `process`
 * receives only the job. It MUST be side-effect-honest: resolve on success (or on a handled, terminal
 * outcome such as marking a photo rejected), reject only for RETRYABLE failures — the consume loop
 * translates a rejection into a broker nack (retry), and a resolution into an ack.
 */
export interface Processor<TPayload = unknown> {
  /** The job type this processor serves (== the broker queue name in production). */
  readonly type: JobType;
  /**
   * Execute the job. Resolve on success/handled-terminal; reject only to trigger a retry. A long
   * processor observes `cancellation` at safe points (via its pipeline) so it can abort promptly on
   * shutdown — a cancelled job is retryable (redelivered later), never marked terminal.
   */
  process(job: Job<TPayload>, cancellation?: CancellationToken): Promise<void>;
}

/** A registry + resolver from `JobType` → `Processor`. Registration is composition-time and exclusive. */
export class ProcessorRegistry {
  private readonly processors = new Map<JobType, Processor>();

  /** Register a processor for its `type`. Throws `DuplicateProcessorError` if the type is claimed. */
  register<TPayload>(processor: Processor<TPayload>): this {
    if (this.processors.has(processor.type)) {
      throw new DuplicateProcessorError(processor.type);
    }
    // Dispatch is keyed by the same `type`, so erasing the payload type at storage time is sound —
    // a processor only ever receives a job of its own type.
    this.processors.set(processor.type, processor as Processor);
    return this;
  }

  /** Resolve the processor for `type`, or `undefined` when none is registered. */
  resolve(type: JobType): Processor | undefined {
    return this.processors.get(type);
  }

  /** Whether a processor is registered for `type`. */
  has(type: JobType): boolean {
    return this.processors.has(type);
  }

  /** The set of handled job types (sorted, for stable diagnostics). */
  get types(): readonly JobType[] {
    return [...this.processors.keys()].sort();
  }
}
