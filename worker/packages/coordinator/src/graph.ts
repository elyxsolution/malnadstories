import { deepFreeze } from '@workerv2/utils';
import type {
  ExecutionPlan,
  PipelineId,
  ProcessingPipeline,
  ProcessingStep,
  StepId,
} from '@workerv2/processing';
import { compileExecutionPlan } from '@workerv2/processing';

/**
 * The EXECUTION GRAPH — the immutable, precomputed structure the coordinator schedules
 * against. Derived ONCE from a validated `ProcessingPipeline` (a compiled Manifest bridges in
 * as one): the canonical deterministic order + parallel stages (reusing the processing
 * framework's Kahn ordering, so coordinator, manifest, and pipeline all agree), plus the
 * dependency and dependent adjacency needed to answer "is this node ready?" and "who unblocks
 * when this node succeeds?" in constant work.
 *
 * The graph is pure topology — it holds NO execution state. Execution state lives in the
 * separate, serializable `ExecutionState`, so the graph can be rebuilt from the pipeline while
 * state is rebuilt from the journal (Resume).
 */
export interface ExecutionGraph {
  readonly pipelineId: PipelineId;
  readonly pipelineVersion: string;
  /** Every node by id. */
  readonly nodes: Readonly<Record<string, ProcessingStep>>;
  /** Canonical total order (stage-monotonic, lexicographic within a stage) — deterministic. */
  readonly order: readonly StepId[];
  /** Parallelizable stages (stage N's nodes are mutually independent). */
  readonly stages: readonly (readonly StepId[])[];
  /** node id → the ids it directly depends on (sorted). */
  readonly dependencies: Readonly<Record<string, readonly StepId[]>>;
  /** node id → the ids that directly depend on it (sorted). */
  readonly dependents: Readonly<Record<string, readonly StepId[]>>;
  /** Nodes nothing depends on — their outputs are the run's final deliverables (sorted). */
  readonly terminal: readonly StepId[];
}

/** Build the immutable execution graph for a validated pipeline. Deterministic and total. */
export function buildExecutionGraph(pipeline: ProcessingPipeline): ExecutionGraph {
  const plan: ExecutionPlan = compileExecutionPlan(pipeline);

  const nodes: Record<string, ProcessingStep> = {};
  const dependencies: Record<string, readonly StepId[]> = {};
  const dependents: Record<string, StepId[]> = {};
  for (const step of pipeline.steps) {
    nodes[step.id] = step;
    dependents[step.id] = [];
  }
  for (const step of pipeline.steps) {
    dependencies[step.id] = [...step.dependsOn].sort();
    for (const dep of step.dependsOn) {
      (dependents[dep] ??= []).push(step.id);
    }
  }
  for (const id of Object.keys(dependents)) dependents[id]?.sort();

  const dependedOn = new Set<string>();
  for (const step of pipeline.steps) for (const dep of step.dependsOn) dependedOn.add(dep);
  const terminal = pipeline.steps
    .map((s) => s.id)
    .filter((id) => !dependedOn.has(id))
    .sort();

  const graph: ExecutionGraph = {
    pipelineId: plan.pipelineId,
    pipelineVersion: plan.pipelineVersion,
    nodes,
    order: plan.order,
    stages: plan.stages,
    dependencies,
    dependents,
    terminal,
  };
  deepFreeze(graph);
  return graph;
}

/** The node ids of the graph, in canonical order. */
export function graphNodeIds(graph: ExecutionGraph): readonly StepId[] {
  return graph.order;
}
