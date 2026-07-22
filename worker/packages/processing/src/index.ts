// @workerv2/processing — the generic, framework-independent DECLARATIVE processing model
// (INV-5): steps, pipelines, execution plans, context, DAG validation, and declarative
// retry/timeout/cancellation/failure policies, plus the processor contracts future engines
// implement. Pure data + pure functions — NO execution engine, NO scheduling, NO business
// logic. Artifact-centric: steps consume/produce content-addressed artifact identities.

// --- Errors ---
export { PipelineDefinitionError } from './errors.js';

// --- Ids + slots ---
export type { StepId, PipelineId } from './ids.js';
export { makeStepId, makePipelineId, isValidSlotName } from './ids.js';

// --- Capability requirements (structurally = runtime negotiation contracts) ---
export type { StepCapabilityRequirement } from './capabilities.js';
export { isValidCapabilityRequirement } from './capabilities.js';

// --- Declarative policies: retry / timeout / cancellation / failure ---
export type { RetryPolicy } from './policies/retry.js';
export { NO_RETRY, validateRetryPolicy, delayBeforeAttempt } from './policies/retry.js';
export type { TimeoutPolicy } from './policies/timeout.js';
export { validateTimeoutPolicy } from './policies/timeout.js';
export type { CancellationPolicy, CancellationSignal } from './policies/cancellation.js';
export {
  DEFAULT_CANCELLATION,
  NEVER_CANCELLED,
  validateCancellationPolicy,
} from './policies/cancellation.js';
export type {
  FailureKind,
  StepFailure,
  FailurePolicy,
  PlannedFailureAction,
} from './policies/failure.js';
export {
  FAILURE_KINDS,
  DEFAULT_FAILURE_POLICY,
  stepFailure,
  validateFailurePolicy,
  planFailureAction,
} from './policies/failure.js';

// --- Step model (artifact-centric) ---
export type { ArtifactInputBinding, ProcessingStep, ProcessingStepSpec } from './step.js';
export { fromArtifact, fromStepOutput } from './step.js';

// --- Dependency graph (DAG validation + deterministic stages) ---
export type { StepGraphNode, StepGraphOrder } from './graph.js';
export { orderStepGraph } from './graph.js';

// --- Pipeline model ---
export type { ProcessingPipeline, ProcessingPipelineSpec } from './pipeline.js';
export { definePipeline } from './pipeline.js';

// --- Execution plan model ---
export type { PlannedStep, ExecutionPlan } from './plan.js';
export { compileExecutionPlan } from './plan.js';

// --- Processing context ---
export type { ProcessingContext, ProcessingContextSpec } from './context.js';
export { makeProcessingContext } from './context.js';

// --- Processor contracts ---
export type {
  ProcessorDescriptor,
  ProcessorSuccess,
  ProcessorOutcome,
  Processor,
  ProcessorResolver,
} from './processor.js';
export { validateProcessorOutputs } from './processor.js';
