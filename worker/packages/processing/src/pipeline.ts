import type { Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import { PipelineDefinitionError } from './errors.js';
import { makePipelineId, makeStepId, isValidSlotName } from './ids.js';
import type { PipelineId, StepId } from './ids.js';
import { isValidCapabilityRequirement } from './capabilities.js';
import type { ProcessingStep, ProcessingStepSpec, ArtifactInputBinding } from './step.js';
import { NO_RETRY, validateRetryPolicy } from './policies/retry.js';
import { validateTimeoutPolicy } from './policies/timeout.js';
import { DEFAULT_CANCELLATION, validateCancellationPolicy } from './policies/cancellation.js';
import { DEFAULT_FAILURE_POLICY, validateFailurePolicy } from './policies/failure.js';
import { orderStepGraph } from './graph.js';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * A validated, immutable, DECLARATIVE processing pipeline (INV-5): pure data describing steps +
 * dependencies + policies. The framework guarantees at definition time that the pipeline is a
 * well-formed DAG with consistent artifact wiring — so every future engine (local, distributed,
 * replay) can consume it unchanged and never needs to re-derive validity.
 */
export interface ProcessingPipeline {
  readonly id: PipelineId;
  readonly name: string;
  /** The pipeline definition's own frozen version (semver — pinned per run, INV-11). */
  readonly version: string;
  readonly steps: readonly ProcessingStep[];
}

export interface ProcessingPipelineSpec {
  readonly id: string;
  readonly name?: string;
  readonly version: string;
  readonly steps: readonly ProcessingStepSpec[];
}

type Fail = Result<never, PipelineDefinitionError>;

function fail(message: string, context?: Record<string, string>): Fail {
  return err(new PipelineDefinitionError(message, context === undefined ? {} : { context }));
}

/**
 * Validate a pipeline spec into an immutable `ProcessingPipeline`. This is the ONLY way a
 * pipeline is constructed. Checks: ids/version shape; unique step ids; policies; slot names;
 * unknown/self/duplicate dependencies; every step-output input binding references a DECLARED
 * output of a step the consumer explicitly `dependsOn`; and the dependency graph is acyclic.
 * Deep-frozen on success. Pure — same spec in, same pipeline out.
 */
export function definePipeline(
  spec: ProcessingPipelineSpec,
): Result<ProcessingPipeline, PipelineDefinitionError> {
  const pipelineId = makePipelineId(spec.id);
  if (!pipelineId.ok) {
    return fail(`Invalid pipeline id: ${pipelineId.error.message}`, { id: spec.id });
  }
  if (!SEMVER_RE.test(spec.version)) {
    return fail(`Pipeline version is not semver-shaped: "${spec.version}"`, {
      version: spec.version,
    });
  }
  if (spec.steps.length === 0) {
    return fail('A pipeline must declare at least one step');
  }

  // --- Pass 1: validate each step locally and collect ids/outputs. ---
  const steps: ProcessingStep[] = [];
  const outputsByStep = new Map<string, ReadonlySet<string>>();
  for (const stepSpec of spec.steps) {
    const built = buildStep(stepSpec);
    if (!built.ok) return built;
    if (outputsByStep.has(built.value.id)) {
      return fail(`Duplicate step id "${built.value.id}"`, { step: built.value.id });
    }
    steps.push(built.value);
    outputsByStep.set(built.value.id, new Set(built.value.outputs));
  }

  // --- Pass 2: cross-step wiring (dependencies + artifact bindings). ---
  for (const step of steps) {
    const seen = new Set<string>();
    for (const dep of step.dependsOn) {
      if (seen.has(dep)) {
        return fail(`Step "${step.id}" lists dependency "${dep}" more than once`, {
          step: step.id,
          dependency: dep,
        });
      }
      seen.add(dep);
    }
    for (const [slot, binding] of Object.entries(step.inputs)) {
      if (binding.kind !== 'step-output') continue;
      const producerOutputs = outputsByStep.get(binding.stepId);
      if (producerOutputs === undefined) {
        return fail(
          `Step "${step.id}" input "${slot}" references unknown step "${binding.stepId}"`,
          { step: step.id, slot, producer: binding.stepId },
        );
      }
      if (!producerOutputs.has(binding.output)) {
        return fail(
          `Step "${step.id}" input "${slot}" references undeclared output "${binding.output}" of step "${binding.stepId}"`,
          { step: step.id, slot, producer: binding.stepId, output: binding.output },
        );
      }
      if (!step.dependsOn.includes(binding.stepId)) {
        return fail(
          `Step "${step.id}" consumes output of "${binding.stepId}" but does not declare it in dependsOn`,
          { step: step.id, producer: binding.stepId },
        );
      }
    }
  }

  // --- Pass 3: the dependency graph must be a DAG (also catches unknown/self deps). ---
  const graph = orderStepGraph(steps.map((s) => ({ id: s.id, dependsOn: s.dependsOn })));
  if (!graph.ok) return graph;

  const pipeline: ProcessingPipeline = {
    id: pipelineId.value,
    name: spec.name ?? spec.id,
    version: spec.version,
    steps,
  };
  deepFreeze(pipeline);
  return ok(pipeline);
}

function buildStep(spec: ProcessingStepSpec): Result<ProcessingStep, PipelineDefinitionError> {
  const stepId = makeStepId(spec.id);
  if (!stepId.ok) return fail(`Invalid step id: ${stepId.error.message}`, { id: spec.id });

  if (spec.processor.trim() === '' || spec.processor.length > 200) {
    return fail(`Step "${spec.id}" has an invalid processor name`, { step: spec.id });
  }
  if (spec.processorVersionRange !== undefined && spec.processorVersionRange.trim() === '') {
    return fail(`Step "${spec.id}" has an empty processorVersionRange`, { step: spec.id });
  }

  const dependsOn: StepId[] = [];
  for (const raw of spec.dependsOn ?? []) {
    const dep = makeStepId(raw);
    if (!dep.ok) return fail(`Step "${spec.id}" has invalid dependency id "${raw}"`);
    dependsOn.push(dep.value);
  }

  const inputs: Record<string, ArtifactInputBinding> = {};
  for (const [slot, binding] of Object.entries(spec.inputs ?? {})) {
    if (!isValidSlotName(slot)) {
      return fail(`Step "${spec.id}" has an invalid input slot name "${slot}"`, {
        step: spec.id,
        slot,
      });
    }
    if (binding.kind === 'artifact') {
      if (binding.key.trim() === '') {
        return fail(`Step "${spec.id}" input "${slot}" has an empty artifact key`);
      }
      inputs[slot] = { kind: 'artifact', key: binding.key as StorageKey };
    } else {
      const producer = makeStepId(binding.stepId);
      if (!producer.ok) {
        return fail(`Step "${spec.id}" input "${slot}" has an invalid producer step id`);
      }
      if (!isValidSlotName(binding.output)) {
        return fail(`Step "${spec.id}" input "${slot}" references invalid output name`, {
          step: spec.id,
          slot,
        });
      }
      inputs[slot] = { kind: 'step-output', stepId: producer.value, output: binding.output };
    }
  }

  const outputs = spec.outputs ?? [];
  const outputSet = new Set<string>();
  for (const output of outputs) {
    if (!isValidSlotName(output)) {
      return fail(`Step "${spec.id}" has an invalid output slot name "${output}"`);
    }
    if (outputSet.has(output)) {
      return fail(`Step "${spec.id}" declares output "${output}" more than once`);
    }
    outputSet.add(output);
  }

  for (const req of spec.requires ?? []) {
    if (!isValidCapabilityRequirement(req)) {
      return fail(`Step "${spec.id}" has an invalid capability requirement`, {
        step: spec.id,
        capability: req.name,
      });
    }
  }

  const retry = validateRetryPolicy(spec.retry ?? NO_RETRY);
  if (!retry.ok) return fail(`Step "${spec.id}": ${retry.error.message}`);
  const cancellation = validateCancellationPolicy(spec.cancellation ?? DEFAULT_CANCELLATION);
  if (!cancellation.ok) return fail(`Step "${spec.id}": ${cancellation.error.message}`);
  const failure = validateFailurePolicy(spec.failure ?? DEFAULT_FAILURE_POLICY);
  if (!failure.ok) return fail(`Step "${spec.id}": ${failure.error.message}`);
  if (spec.timeout !== undefined) {
    const timeout = validateTimeoutPolicy(spec.timeout);
    if (!timeout.ok) return fail(`Step "${spec.id}": ${timeout.error.message}`);
  }

  const step: ProcessingStep = {
    id: stepId.value,
    name: spec.name ?? spec.id,
    processor: spec.processor,
    ...(spec.processorVersionRange === undefined
      ? {}
      : { processorVersionRange: spec.processorVersionRange }),
    dependsOn,
    inputs,
    outputs: [...outputs],
    requires: [...(spec.requires ?? [])],
    config: spec.config ?? {},
    retry: retry.value,
    ...(spec.timeout === undefined ? {} : { timeout: spec.timeout }),
    cancellation: cancellation.value,
    failure: failure.value,
  };
  return ok(step);
}
