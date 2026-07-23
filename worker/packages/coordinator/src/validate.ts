import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { CoordinatorError } from './errors.js';

/**
 * COORDINATOR VALIDATION — the untrusted-state gate. A state may arrive from a resumed journal
 * or an external checkpoint; this proves it is CONSISTENT with the bound graph before the
 * coordinator trusts it: the node set matches the graph exactly, every node's lifecycle
 * respects the dependency rule (a node cannot be ready/running/succeeded unless all its
 * dependencies have succeeded), success records outputs, and the run-level status agrees with
 * the node states (a succeeded run has all nodes succeeded; a terminal run has nothing
 * running). Pure and deterministic.
 */
export function validateExecutionState(
  graph: ExecutionGraph,
  state: ExecutionState,
): Result<void, CoordinatorError> {
  const fail = (
    message: string,
    context?: Record<string, string>,
  ): Result<void, CoordinatorError> =>
    err(new CoordinatorError(message, context === undefined ? {} : { context }));

  if (state.pipelineId !== graph.pipelineId) {
    return fail('Execution state pipeline id does not match the graph', {
      state: state.pipelineId,
      graph: graph.pipelineId,
    });
  }
  if (!Number.isInteger(state.seq) || state.seq < 0) {
    return fail(`Execution state seq must be a non-negative integer (got ${state.seq})`);
  }

  const graphIds = new Set<string>(graph.order);
  const stateIds = Object.keys(state.nodes);
  if (stateIds.length !== graphIds.size) {
    return fail('Execution state node set does not match the graph');
  }
  for (const id of stateIds) {
    if (!graphIds.has(id)) return fail(`Execution state has unknown node "${id}"`, { node: id });
    const node = state.nodes[id];
    if (node === undefined || node.id !== id) {
      return fail(`Execution state node "${id}" is malformed`, { node: id });
    }
    if (!Number.isInteger(node.attempt) || node.attempt < 0 || node.attempts < node.attempt - 1) {
      return fail(`Node "${id}" has inconsistent attempt counters`, { node: id });
    }
    if (node.state === 'ready' || node.state === 'running' || node.state === 'succeeded') {
      for (const dep of graph.dependencies[id] ?? []) {
        if (state.nodes[dep]?.state !== 'succeeded') {
          return fail(`Node "${id}" is "${node.state}" but dependency "${dep}" has not succeeded`, {
            node: id,
            dependency: dep,
          });
        }
      }
    }
    if (node.state === 'succeeded' && node.outputs === undefined) {
      return fail(`Node "${id}" is succeeded but records no outputs`, { node: id });
    }
    if (node.state === 'running' && (node.startedAt === undefined || node.attempts < 1)) {
      return fail(`Node "${id}" is running but has no started attempt`, { node: id });
    }
  }

  const anyRunning = stateIds.some((id) => state.nodes[id]?.state === 'running');
  const terminal =
    state.status === 'succeeded' || state.status === 'failed' || state.status === 'cancelled';
  if (terminal && anyRunning) {
    return fail(`Run is "${state.status}" but a node is still running`);
  }
  if (state.status === 'succeeded') {
    const allSucceeded = stateIds.every((id) => state.nodes[id]?.state === 'succeeded');
    if (!allSucceeded) return fail('Run is succeeded but not every node succeeded');
    if (state.stopping !== undefined) return fail('A succeeded run cannot be marked as stopping');
  }
  return ok(undefined);
}
