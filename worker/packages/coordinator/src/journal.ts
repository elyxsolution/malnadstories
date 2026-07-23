import type { JsonObject, Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { StepId } from '@workerv2/processing';
import type { FailureKind } from '@workerv2/processing';
import type { Timestamp } from '@workerv2/control-plane';
import { RUN_MACHINE } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import type { NodeExecution, NodeState, NodeTrigger } from './node-state.js';
import { NODE_MACHINE } from './node-state.js';
import { CoordinatorError } from './errors.js';
import { addMillis } from './time.js';

/**
 * The EXECUTION JOURNAL — the append-only, ordered record of EVERY state transition the
 * coordinator makes (INV-9 in spirit). It is the single source of truth for a run's execution
 * history and the ONLY thing that mutates `ExecutionState`: every command decides a list of
 * journal entries, and the state is always the fold of those entries (`applyJournalEntry`).
 *
 * Because state change flows exclusively through the journal, Resume is literally re-folding a
 * persisted journal — the reconstructed state is provably identical, with no side-effect drift
 * (INV-7). Entries carry exactly the data needed to reconstruct state (produced outputs, retry
 * `readyAt`, failure kind), so the fold needs only the graph (for timeout deadlines) and the
 * entries — never the original command inputs.
 */

export type JournalKind =
  | 'run.started'
  | 'node.armed' // pending -> ready (dependencies satisfied)
  | 'node.dispatched' // ready -> running (an attempt begins)
  | 'node.succeeded' // running -> succeeded
  | 'node.retry-scheduled' // running -> ready (a retry with budget)
  | 'node.failed' // running -> failed
  | 'node.cancelled' // -> cancelled
  | 'node.skipped' // -> skipped
  | 'cancellation.requested' // a cancel request began draining the run
  | 'run.stopping' // a terminal failure began draining the run
  | 'run.succeeded'
  | 'run.failed'
  | 'run.cancelled';

/** One immutable, ordered journal entry. `seq` is 0-based and contiguous within a run. */
export interface JournalEntry {
  readonly seq: number;
  readonly at: Timestamp;
  readonly kind: JournalKind;
  /** The node this entry concerns (absent for run-level entries). */
  readonly node?: StepId;
  readonly from?: string;
  readonly to?: string;
  /** The attempt number this entry concerns (dispatch / retry / failure). */
  readonly attempt?: number;
  /** Reconstruction + provenance detail (JSON-safe; no secrets/PII). */
  readonly detail?: JsonObject;
}

/** A journal entry before its sequence number is assigned (the coordinator assigns `seq`). */
export type JournalEntrySpec = Omit<JournalEntry, 'seq'>;

const NODE_TRIGGERS: Partial<Record<JournalKind, NodeTrigger>> = {
  'node.armed': 'arm',
  'node.dispatched': 'dispatch',
  'node.succeeded': 'succeed',
  'node.retry-scheduled': 'reschedule',
  'node.failed': 'fail',
  'node.cancelled': 'cancel',
  'node.skipped': 'skip',
};

const RUN_TRIGGERS = {
  'run.started': 'start',
  'run.succeeded': 'succeed',
  'run.failed': 'fail',
  'run.cancelled': 'cancel',
} as const;

function fail(message: string, context?: JsonObject): Result<never, CoordinatorError> {
  return err(new CoordinatorError(message, context === undefined ? {} : { context }));
}

function readString(detail: JsonObject | undefined, key: string): string | undefined {
  const value = detail?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readOutputs(detail: JsonObject | undefined): Record<string, StorageKey> {
  const raw = detail?.['outputs'];
  const out: Record<string, StorageKey> = {};
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [slot, value] of Object.entries(raw)) {
      if (typeof value === 'string') out[slot] = value as StorageKey;
    }
  }
  return out;
}

/**
 * Fold ONE journal entry into an execution state — the single, total, deterministic state
 * mutator. Validates that the entry is well-formed and legal (contiguous seq, known node,
 * legal node/run transition) so a forged or corrupt journal is rejected rather than producing
 * a nonsense state. Pure: same (graph, state, entry) → same next state.
 */
export function applyJournalEntry(
  graph: ExecutionGraph,
  state: ExecutionState,
  entry: JournalEntry,
): Result<ExecutionState, CoordinatorError> {
  if (entry.seq !== state.seq) {
    return fail(`Journal entry out of order: expected seq ${state.seq}, got ${entry.seq}`, {
      expected: state.seq,
      got: entry.seq,
    });
  }

  const nodeTrigger = NODE_TRIGGERS[entry.kind];
  if (nodeTrigger !== undefined) {
    return applyNodeEntry(graph, state, entry, nodeTrigger);
  }
  return applyRunEntry(state, entry);
}

function applyNodeEntry(
  graph: ExecutionGraph,
  state: ExecutionState,
  entry: JournalEntry,
  trigger: NodeTrigger,
): Result<ExecutionState, CoordinatorError> {
  if (entry.node === undefined) return fail(`Journal entry "${entry.kind}" is missing its node`);
  const prev = state.nodes[entry.node];
  if (prev === undefined || graph.nodes[entry.node] === undefined) {
    return fail(`Journal references unknown node "${entry.node}"`, { node: entry.node });
  }
  const next = NODE_MACHINE.nextState(prev.state, trigger);
  if (!next.ok) {
    return fail(
      `Illegal node transition for "${entry.node}": ${prev.state} --${trigger}--> (${entry.kind})`,
      { node: entry.node, from: prev.state, trigger },
    );
  }

  const node = reduceNode(graph, prev, next.value, entry);
  return ok(commitNode(state, entry, node));
}

/** Compute the node's next execution record for a legal transition. Pure. */
function reduceNode(
  graph: ExecutionGraph,
  prev: NodeExecution,
  to: NodeState,
  entry: JournalEntry,
): NodeExecution {
  const cleared: NodeExecution = {
    id: prev.id,
    state: to,
    attempt: prev.attempt,
    attempts: prev.attempts,
    ...(prev.firstStartedAt === undefined ? {} : { firstStartedAt: prev.firstStartedAt }),
    ...(prev.outputs === undefined ? {} : { outputs: prev.outputs }),
    ...(prev.lastFailure === undefined ? {} : { lastFailure: prev.lastFailure }),
  };

  switch (entry.kind) {
    case 'node.armed':
      return {
        ...cleared,
        readyAt: (readString(entry.detail, 'readyAt') ?? entry.at) as Timestamp,
      };
    case 'node.retry-scheduled':
      return {
        ...cleared,
        attempt: prev.attempt + 1,
        readyAt: (readString(entry.detail, 'readyAt') ?? entry.at) as Timestamp,
        lastFailure: {
          kind: (readString(entry.detail, 'failureKind') ?? 'transient') as FailureKind,
          message: readString(entry.detail, 'failureMessage') ?? '',
        },
      };
    case 'node.dispatched': {
      const step = graph.nodes[prev.id];
      const startedAt = entry.at;
      const firstStartedAt = prev.firstStartedAt ?? entry.at;
      const attempts = prev.attempts + 1;
      const timeout = step?.timeout;
      return {
        id: prev.id,
        state: to,
        attempt: attempts,
        attempts,
        firstStartedAt,
        startedAt,
        ...(timeout === undefined
          ? {}
          : {
              attemptDeadline: addMillis(startedAt, timeout.attemptTimeoutMs),
              ...(timeout.overallTimeoutMs === undefined
                ? {}
                : { overallDeadline: addMillis(firstStartedAt, timeout.overallTimeoutMs) }),
            }),
        ...(prev.lastFailure === undefined ? {} : { lastFailure: prev.lastFailure }),
      };
    }
    case 'node.succeeded':
      return {
        ...cleared,
        ...(prev.startedAt === undefined ? {} : { startedAt: prev.startedAt }),
        outputs: readOutputs(entry.detail),
      };
    case 'node.failed':
      return {
        ...cleared,
        lastFailure: {
          kind: (readString(entry.detail, 'failureKind') ?? 'permanent') as FailureKind,
          message: readString(entry.detail, 'failureMessage') ?? '',
        },
      };
    case 'node.cancelled':
    case 'node.skipped':
    default:
      return cleared;
  }
}

function commitNode(
  state: ExecutionState,
  entry: JournalEntry,
  node: NodeExecution,
): ExecutionState {
  const next: ExecutionState = {
    ...state,
    nodes: { ...state.nodes, [node.id]: node },
    seq: state.seq + 1,
    updatedAt: entry.at,
  };
  deepFreeze(next);
  return next;
}

function applyRunEntry(
  state: ExecutionState,
  entry: JournalEntry,
): Result<ExecutionState, CoordinatorError> {
  // Draining markers change no run status — they only flag that the run is winding down.
  if (entry.kind === 'cancellation.requested') {
    return ok(
      commitRun(state, entry, {
        stopping: 'cancel',
        cancellationReason: readString(entry.detail, 'reason') ?? '',
      }),
    );
  }
  if (entry.kind === 'run.stopping') {
    return ok(commitRun(state, entry, { stopping: 'fail' }));
  }

  const trigger = RUN_TRIGGERS[entry.kind as keyof typeof RUN_TRIGGERS];
  const next = RUN_MACHINE.nextState(state.status, trigger);
  if (!next.ok) {
    return fail(`Illegal run transition: ${state.status} --${trigger}--> (${entry.kind})`, {
      from: state.status,
      trigger,
    });
  }
  return ok(
    commitRun(state, entry, {
      status: next.value,
      ...(entry.kind === 'run.started' ? { startedAt: entry.at } : {}),
    }),
  );
}

function commitRun(
  state: ExecutionState,
  entry: JournalEntry,
  patch: Partial<ExecutionState>,
): ExecutionState {
  const next: ExecutionState = {
    ...state,
    ...patch,
    seq: state.seq + 1,
    updatedAt: entry.at,
  };
  deepFreeze(next);
  return next;
}
