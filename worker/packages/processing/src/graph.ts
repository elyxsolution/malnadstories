import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { PipelineDefinitionError } from './errors.js';

/**
 * DEPENDENCY-GRAPH validation for the processing model. Pure and DETERMINISTIC: Kahn's
 * algorithm with lexicographic tie-breaking, so the same set of edges yields the same
 * result regardless of declaration order — a prerequisite for reproducible plans (INV-5/11).
 */
export interface StepGraphNode {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

export interface StepGraphOrder {
  /**
   * Flat execution order — the stages flattened: dependencies always precede dependents,
   * lexicographic within a stage. One canonical order, fully deterministic.
   */
  readonly order: readonly string[];
  /**
   * Parallelizable STAGES: stage N contains every step whose longest dependency chain has
   * length N. Steps within one stage are mutually independent — any engine may run them
   * concurrently; running stages sequentially is always correct.
   */
  readonly stages: readonly (readonly string[])[];
}

export function orderStepGraph(
  nodes: readonly StepGraphNode[],
): Result<StepGraphOrder, PipelineDefinitionError> {
  const byId = new Map<string, StepGraphNode>();
  for (const node of nodes) byId.set(node.id, node);

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.id) {
        return err(
          new PipelineDefinitionError(`Step "${node.id}" depends on itself`, {
            context: { step: node.id },
          }),
        );
      }
      if (!byId.has(dep)) {
        return err(
          new PipelineDefinitionError(`Step "${node.id}" depends on unknown step "${dep}"`, {
            context: { step: node.id, missing: dep },
          }),
        );
      }
    }
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) inDegree.set(node.id, node.dependsOn.length);
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  // Level (longest dependency chain) per node — drives the stage grouping.
  const level = new Map<string, number>();
  const ready: string[] = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  for (const id of ready) level.set(id, 0);

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    order.push(id);
    const nodeLevel = level.get(id) ?? 0;

    for (const dependent of [...(dependents.get(id) ?? [])].sort()) {
      level.set(dependent, Math.max(level.get(dependent) ?? 0, nodeLevel + 1));
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== nodes.length) {
    const unresolved = nodes
      .map((n) => n.id)
      .filter((id) => !order.includes(id))
      .sort();
    return err(
      new PipelineDefinitionError('Step dependency graph has a cycle', {
        context: { unresolved },
      }),
    );
  }

  const stageCount = order.length === 0 ? 0 : Math.max(...[...level.values()]) + 1;
  const stages: string[][] = Array.from({ length: stageCount }, () => []);
  for (const id of order) {
    stages[level.get(id) ?? 0]?.push(id);
  }
  for (const stage of stages) stage.sort();

  // The canonical flat order is the stages flattened (stage-monotonic; sorted within a stage).
  return ok({ order: stages.flat(), stages });
}
