import type { StorageKey } from '@workerv2/infra-contracts';
import type { Timestamp } from '@workerv2/control-plane';
import type { Coordinator, ExecutionState } from '@workerv2/coordinator';

/**
 * EXECUTION DIAGNOSTICS — an OBSERVATIONAL projection of a finished (or settled) run. It is derived
 * purely from the Coordinator's `ExecutionState` after the fact; it NEVER influences execution
 * (nothing here feeds back into the Coordinator or the driver). It surfaces the execution summary,
 * the processor execution order, the produced Artifacts, the duration, retry information, and
 * validation failures — for humans and tests, not for control flow.
 */

export interface NodeDiagnostic {
  readonly nodeId: string;
  readonly processor: string;
  readonly state: string;
  readonly attempts: number;
  readonly outputs: Readonly<Record<string, StorageKey>>;
  readonly failure?: { readonly kind: string; readonly message: string };
}

export interface ExecutionDiagnostics {
  readonly runId: string;
  readonly status: string;
  readonly settled: boolean;
  readonly totalNodes: number;
  readonly completedNodes: number;
  /** The order nodes reached a running state (processor execution order). */
  readonly executionOrder: readonly string[];
  readonly nodes: readonly NodeDiagnostic[];
  /** Every Artifact produced across the run, keyed by `<nodeId>.<outputSlot>`. */
  readonly producedArtifacts: Readonly<Record<string, StorageKey>>;
  /** Total wall-time between the run's first and last recorded instants (ms), if timed. */
  readonly durationMs?: number;
  /** Total retry attempts beyond the first across all nodes. */
  readonly totalRetries: number;
  /** Nodes that failed, with their failure kind + message. */
  readonly failures: readonly {
    readonly nodeId: string;
    readonly kind: string;
    readonly message: string;
  }[];
}

/** Build the observational diagnostics for a settled run's execution state. */
export function buildDiagnostics(
  coordinator: Coordinator,
  state: ExecutionState,
  timing?: { readonly startedAt?: string; readonly finishedAt?: string },
): ExecutionDiagnostics {
  const graphNodes = coordinator.graph.nodes;
  const nodeIds = Object.keys(state.nodes).sort();

  const nodes: NodeDiagnostic[] = [];
  const producedArtifacts: Record<string, StorageKey> = {};
  const failures: { nodeId: string; kind: string; message: string }[] = [];
  let completedNodes = 0;
  let totalRetries = 0;

  for (const nodeId of nodeIds) {
    const node = state.nodes[nodeId];
    if (node === undefined) continue;
    const processor = graphNodes[nodeId]?.processor ?? 'unknown';
    const outputs = node.outputs ?? {};
    for (const [slot, key] of Object.entries(outputs)) producedArtifacts[`${nodeId}.${slot}`] = key;
    if (node.state === 'succeeded') completedNodes += 1;
    totalRetries += Math.max(0, node.attempts - 1);
    const diagnostic: NodeDiagnostic = {
      nodeId,
      processor,
      state: node.state,
      attempts: node.attempts,
      outputs: { ...outputs },
      ...(node.lastFailure === undefined
        ? {}
        : { failure: { kind: node.lastFailure.kind, message: node.lastFailure.message } }),
    };
    nodes.push(diagnostic);
    if (node.state === 'failed' && node.lastFailure !== undefined) {
      failures.push({ nodeId, kind: node.lastFailure.kind, message: node.lastFailure.message });
    }
  }

  // Execution order = nodes that started, sorted by their first-started instant (deterministic).
  const executionOrder = nodeIds
    .map((id) => ({ id, at: state.nodes[id]?.firstStartedAt }))
    .filter((n): n is { id: string; at: Timestamp } => n.at !== undefined)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
    .map((n) => n.id);

  const durationMs =
    timing?.startedAt !== undefined && timing.finishedAt !== undefined
      ? Date.parse(timing.finishedAt) - Date.parse(timing.startedAt)
      : undefined;

  return {
    runId: state.runId,
    status: state.status,
    settled: coordinator.progress(state).settled,
    totalNodes: nodeIds.length,
    completedNodes,
    executionOrder,
    nodes,
    producedArtifacts,
    ...(durationMs === undefined ? {} : { durationMs }),
    totalRetries,
    failures,
  };
}
