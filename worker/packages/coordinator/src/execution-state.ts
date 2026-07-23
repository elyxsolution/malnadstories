import { deepFreeze } from '@workerv2/utils';
import type { PipelineId, StepId } from '@workerv2/processing';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { RunState } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { NodeExecution, StoppingReason } from './node-state.js';

/**
 * The EXECUTION STATE — the immutable, serializable snapshot of a run's progress: the run's
 * lifecycle status (a Control-Plane `RunState`), whether it is winding down, and the execution
 * record of every node keyed by its Manifest node id (the primary execution identity). It
 * holds NO topology (that is the `ExecutionGraph`) and NO history (that is the journal), so it
 * stays small and reconstructable — the journal folds into exactly this (Resume).
 *
 * `seq` is the count of journal entries folded so far — equivalently the sequence number the
 * NEXT entry will carry — which makes the state and its journal always consistent.
 */
export interface ExecutionState {
  readonly runId: RunId;
  readonly pipelineId: PipelineId;
  readonly status: RunState;
  /** Set once a terminal failure or a cancellation has begun draining the run; cleared never. */
  readonly stopping?: StoppingReason;
  /** The reason text supplied when cancellation was requested (JSON-safe). */
  readonly cancellationReason?: string;
  /** Per-node execution records, keyed by node id. */
  readonly nodes: Readonly<Record<string, NodeExecution>>;
  /** Number of journal entries folded into this state so far (= next entry's seq). */
  readonly seq: number;
  /** When the run started (set on `run.started`). */
  readonly startedAt?: Timestamp;
  /** When the last transition was applied (the last folded entry's injected time). */
  readonly updatedAt?: Timestamp;
}

/**
 * The seed state for a run: every node `pending`, the run `pending`, no entries folded.
 * Deterministic — same graph + runId → same seed. Deep-frozen.
 */
export function initialExecutionState(graph: ExecutionGraph, runId: RunId): ExecutionState {
  const nodes: Record<string, NodeExecution> = {};
  for (const id of graph.order) {
    nodes[id] = { id, state: 'pending', attempt: 0, attempts: 0 };
  }
  const state: ExecutionState = {
    runId,
    pipelineId: graph.pipelineId,
    status: 'pending',
    nodes,
    seq: 0,
  };
  deepFreeze(state);
  return state;
}

/** Look up one node's execution record. */
export function nodeExecution(state: ExecutionState, id: string): NodeExecution | undefined {
  return state.nodes[id];
}

/** Every node execution in canonical graph order. */
export function nodeExecutions(
  graph: ExecutionGraph,
  state: ExecutionState,
): readonly NodeExecution[] {
  const out: NodeExecution[] = [];
  for (const id of graph.order) {
    const node = state.nodes[id];
    if (node !== undefined) out.push(node);
  }
  return out;
}

/** Ids of nodes currently in `running` (used to test run quiescence). */
export function runningNodeIds(graph: ExecutionGraph, state: ExecutionState): readonly StepId[] {
  return graph.order.filter((id) => state.nodes[id]?.state === 'running');
}
