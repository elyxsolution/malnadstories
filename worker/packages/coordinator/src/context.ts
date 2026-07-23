import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  CancellationSignal,
  ProcessingContext,
  ProcessingStep,
  ProcessorResolver,
} from '@workerv2/processing';
import { makeProcessingContext } from '@workerv2/processing';
import type { RunId, Timestamp, VersionSet } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { CoordinatorError } from './errors.js';

/**
 * CONTEXT RESOLUTION — the coordinator BUILDS the immutable `ProcessingContext` an engine
 * hands a processor for one attempt, but never runs the processor itself. Building the context
 * is pure orchestration: it resolves each declared input binding to a concrete artifact
 * identity — an `artifact` binding is its own content address; a `step-output` binding is read
 * from the RECORDED outputs of the already-succeeded upstream node (which is why the coordinator
 * records outputs on success). The run's frozen version pins (INV-11) and the injected attempt
 * time flow through unchanged. No I/O, no artifact loading — only identity plumbing.
 */

/** Resolve a step's input bindings to concrete artifact identities from the current state. */
export function resolveInputs(
  state: ExecutionState,
  step: ProcessingStep,
): Result<Record<string, StorageKey>, CoordinatorError> {
  const inputs: Record<string, StorageKey> = {};
  for (const [slot, binding] of Object.entries(step.inputs)) {
    if (binding.kind === 'artifact') {
      inputs[slot] = binding.key;
      continue;
    }
    const producer = state.nodes[binding.stepId];
    if (
      producer === undefined ||
      producer.state !== 'succeeded' ||
      producer.outputs === undefined
    ) {
      return err(
        new CoordinatorError(
          `Cannot resolve input "${slot}" of "${step.id}": upstream "${binding.stepId}" has not succeeded`,
          { context: { step: step.id, slot, producer: binding.stepId } },
        ),
      );
    }
    const key = producer.outputs[binding.output];
    if (key === undefined) {
      return err(
        new CoordinatorError(
          `Upstream "${binding.stepId}" did not produce output "${binding.output}" for "${step.id}"`,
          { context: { step: step.id, slot, producer: binding.stepId, output: binding.output } },
        ),
      );
    }
    inputs[slot] = key;
  }
  return ok(inputs);
}

/** Build the fully-resolved `ProcessingContext` for the current attempt of a running node. */
export function buildProcessingContext(
  graph: ExecutionGraph,
  state: ExecutionState,
  versions: VersionSet,
  runId: RunId,
  nodeId: string,
  attempt: number,
  startedAt: Timestamp,
  cancellation?: CancellationSignal,
): Result<ProcessingContext, CoordinatorError> {
  const step = graph.nodes[nodeId];
  if (step === undefined) {
    return err(new CoordinatorError(`Unknown node "${nodeId}"`, { context: { node: nodeId } }));
  }
  const inputs = resolveInputs(state, step);
  if (!inputs.ok) return inputs;

  const context = makeProcessingContext({
    runId,
    pipelineId: graph.pipelineId,
    stepId: step.id,
    attempt,
    inputs: inputs.value,
    expectedOutputs: step.outputs,
    config: step.config,
    versions: versions.toJSON(),
    startedAt,
    ...(cancellation === undefined ? {} : { cancellation }),
  });
  if (!context.ok) {
    return err(
      new CoordinatorError(
        `Failed to build processing context for "${nodeId}": ${context.error.message}`,
        {
          context: { node: nodeId },
        },
      ),
    );
  }
  return ok(context.value);
}

/**
 * Accept processor interfaces WITHOUT executing them: verify every node's named processor
 * resolves through the given `ProcessorResolver`. A pre-run readiness check an adapter can use
 * to fail fast on a missing/incompatible processor — the coordinator inspects the resolver, it
 * never calls `process()`.
 */
export function validateProcessors(
  graph: ExecutionGraph,
  resolver: ProcessorResolver,
): Result<void, CoordinatorError> {
  const unresolved: string[] = [];
  for (const id of graph.order) {
    const step = graph.nodes[id];
    if (step === undefined) continue;
    if (resolver.resolve(step.processor, step.processorVersionRange) === null) {
      unresolved.push(step.processor);
    }
  }
  if (unresolved.length > 0) {
    return err(
      new CoordinatorError(
        `No processor registered for: ${[...new Set(unresolved)].sort().join(', ')}`,
        {
          context: { unresolved: [...new Set(unresolved)].sort() },
        },
      ),
    );
  }
  return ok(undefined);
}
