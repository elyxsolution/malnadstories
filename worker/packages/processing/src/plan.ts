import { deepFreeze, invariant } from '@workerv2/utils';
import type { PipelineId, StepId } from './ids.js';
import type { ProcessingPipeline } from './pipeline.js';
import type { ProcessingStep } from './step.js';
import { orderStepGraph } from './graph.js';

/**
 * The EXECUTION PLAN — the compiled, immutable, engine-neutral form of a validated pipeline:
 * a deterministic total order plus parallelizable stages. It is still pure DATA (INV-5): any
 * engine (local, distributed, replay) interprets it; the framework schedules nothing.
 */
export interface PlannedStep {
  readonly step: ProcessingStep;
  /** 0-based stage index (= length of the step's longest dependency chain). */
  readonly stage: number;
}

export interface ExecutionPlan {
  readonly pipelineId: PipelineId;
  readonly pipelineVersion: string;
  /** Canonical total order: stage-monotonic, lexicographic within a stage. */
  readonly order: readonly StepId[];
  /** Stage N's steps are mutually independent; stages run in index order. */
  readonly stages: readonly (readonly StepId[])[];
  /** Every step with its stage, in canonical order. */
  readonly steps: readonly PlannedStep[];
}

/**
 * Compile a validated pipeline into its execution plan. TOTAL and DETERMINISTIC: a
 * `ProcessingPipeline` can only exist in validated form (`definePipeline` is the sole
 * constructor and has already proven the DAG), so compilation cannot fail — same pipeline
 * in, structurally identical plan out, regardless of step declaration order.
 */
export function compileExecutionPlan(pipeline: ProcessingPipeline): ExecutionPlan {
  const graph = orderStepGraph(pipeline.steps.map((s) => ({ id: s.id, dependsOn: s.dependsOn })));
  // A ProcessingPipeline is definition-validated; a cycle here means the type was forged.
  invariant(graph.ok, 'compileExecutionPlan received an unvalidated pipeline');

  const byId = new Map<string, ProcessingStep>();
  for (const step of pipeline.steps) byId.set(step.id, step);
  const stageOf = new Map<string, number>();
  graph.value.stages.forEach((stage, index) => {
    for (const id of stage) stageOf.set(id, index);
  });

  const steps: PlannedStep[] = graph.value.order.map((id) => {
    const step = byId.get(id);
    invariant(step !== undefined, `plan references unknown step "${id}"`);
    return { step, stage: stageOf.get(id) ?? 0 };
  });

  const plan: ExecutionPlan = {
    pipelineId: pipeline.id,
    pipelineVersion: pipeline.version,
    order: graph.value.order as readonly StepId[],
    stages: graph.value.stages as readonly (readonly StepId[])[],
    steps,
  };
  deepFreeze(plan);
  return plan;
}
