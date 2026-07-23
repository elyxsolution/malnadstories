import type { RunState } from '@workerv2/control-plane';
import type { ExecutionState } from './execution-state.js';
import type { NodeState } from './node-state.js';
import { isTerminalNodeState } from './node-state.js';

/**
 * The PROGRESS MODEL — a pure, derived, read-only view of how far a run has advanced. It adds
 * no state; it is a deterministic projection of `ExecutionState`, safe to compute anywhere
 * (dashboards, adapters, tests) without touching the coordinator's transition logic.
 */
export interface ExecutionProgress {
  readonly status: RunState;
  readonly total: number;
  /** Count of nodes in each lifecycle state. */
  readonly byState: Readonly<Record<NodeState, number>>;
  /** Nodes in a terminal state (succeeded/failed/cancelled/skipped). */
  readonly completed: number;
  /** Nodes that finished successfully. */
  readonly succeeded: number;
  /** Fraction complete in [0, 1] — terminal nodes over total (1 when there are no nodes). */
  readonly fraction: number;
  /** Whether every node has reached a terminal state. */
  readonly nodesSettled: boolean;
  /** Whether the run itself has reached a terminal lifecycle state. */
  readonly settled: boolean;
}

const ZERO_BY_STATE: Record<NodeState, number> = {
  pending: 0,
  ready: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
  skipped: 0,
};

/** Compute the progress projection of an execution state. Pure and deterministic. */
export function progressOf(state: ExecutionState): ExecutionProgress {
  const byState: Record<NodeState, number> = { ...ZERO_BY_STATE };
  let completed = 0;
  const ids = Object.keys(state.nodes);
  for (const id of ids) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    byState[node.state] += 1;
    if (isTerminalNodeState(node.state)) completed += 1;
  }
  const total = ids.length;
  const settled =
    state.status === 'succeeded' || state.status === 'failed' || state.status === 'cancelled';
  return Object.freeze({
    status: state.status,
    total,
    byState: Object.freeze(byState),
    completed,
    succeeded: byState.succeeded,
    fraction: total === 0 ? 1 : completed / total,
    nodesSettled: completed === total,
    settled,
  });
}
