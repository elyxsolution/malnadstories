import type { Processor, ProcessingContext, ProcessorOutcome } from '@workerv2/processing';
import { stepFailure } from '@workerv2/processing';

/**
 * The PROCESSOR DISPATCHER — the single point where the adapter INVOKES a processor. It calls
 * `processor.process(context)` and returns its `ProcessorOutcome` unchanged, with exactly one
 * piece of adapter robustness: a processor that THROWS (an unexpected exception rather than a
 * declared failure) is normalized into a `transient` `StepFailure`, so the effect loop always
 * gets in-band data and the run's retry policy decides what happens next — a thrown processor
 * never crashes the driver.
 *
 * This is the whole of the adapter's contact with "the work": no rendering, no PDF, no image
 * processing, no storage — just call the injected contract and hand the outcome back to the
 * Coordinator. It adds NO business logic and inspects NO output.
 */
export async function invokeProcessor(
  processor: Processor,
  context: ProcessingContext,
): Promise<ProcessorOutcome> {
  try {
    return await processor.process(context);
  } catch (error) {
    return {
      ok: false,
      error: stepFailure(
        'transient',
        `Processor "${processor.descriptor.name}" threw during "${context.stepId}"`,
        { processor: processor.descriptor.name, reason: errorMessage(error) },
      ),
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
