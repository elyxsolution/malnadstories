import type { Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import { assertNever } from '@workerv2/utils';
import type { RunId } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { initialExecutionState } from './execution-state.js';
import type { NodeExecution } from './node-state.js';
import { CoordinatorError } from './errors.js';

/**
 * The REPLAY MODEL — the SEMANTIC distinction between the four ways a prior run can be re-driven
 * (Rec 18), as data an infrastructure adapter interprets. Scope here is semantics + seam, not a
 * replay UX/tooling platform (that is a reserved future platform).
 *
 * - `retry`      — a NEW run that REUSES the succeeded nodes' outputs and re-executes only the
 *                  incomplete/failed work, on the SAME manifest + SAME frozen versions. Cheapest
 *                  recovery; the coordinator can seed it (`seedReplay`).
 * - `replay`     — a NEW run that re-executes EVERY node from scratch on the SAME manifest +
 *                  SAME frozen versions (an operational redo).
 * - `rebuild`    — like `replay`, but its INTENT is byte-identical REPRODUCTION: the frozen
 *                  Version Matrix (INV-11) is the guarantee, so `rebuild` is the verification path.
 * - `regenerate` — a NEW run from a FRESHLY re-derived manifest under CURRENT versions (the
 *                  source or an engine version changed). The manifest identity changes, so it
 *                  needs a NEW coordinator bound to the new manifest — a documented SEAM here,
 *                  not something this coordinator can seed from the old graph.
 */
export type ReplayMode = 'retry' | 'replay' | 'rebuild' | 'regenerate';

export const REPLAY_MODES: readonly ReplayMode[] = ['retry', 'replay', 'rebuild', 'regenerate'];

/** A request to re-drive a prior run in one of the four replay modes. */
export interface ReplayRequest {
  readonly mode: ReplayMode;
  readonly priorRunId: RunId;
  readonly newRunId: RunId;
}

/** The declarative meaning of a replay mode — first-class data, deterministic per mode. */
export interface ReplayPlan {
  readonly mode: ReplayMode;
  /** Continue the same run or begin a new one. All modes here begin a NEW run (terminal runs never re-open). */
  readonly targetRun: 'new';
  /** Which nodes execute: only the incomplete ones (`retry`) or every node. */
  readonly scope: 'incomplete' | 'all';
  /** Whether the SAME manifest identity is reused (false only for `regenerate`). */
  readonly reusesManifest: boolean;
  /** Whether the SAME frozen version set is reused (false only for `regenerate`). */
  readonly reusesFrozenVersions: boolean;
  /** Whether the mode asserts byte-identical reproduction (only `rebuild`). */
  readonly verifyByteIdentical: boolean;
  readonly description: string;
}

/** The semantic table — pure and total over the four modes. */
export function describeReplay(mode: ReplayMode): ReplayPlan {
  switch (mode) {
    case 'retry':
      return freeze({
        mode,
        targetRun: 'new',
        scope: 'incomplete',
        reusesManifest: true,
        reusesFrozenVersions: true,
        verifyByteIdentical: false,
        description:
          'Re-execute only incomplete work, reusing succeeded outputs, same manifest + versions.',
      });
    case 'replay':
      return freeze({
        mode,
        targetRun: 'new',
        scope: 'all',
        reusesManifest: true,
        reusesFrozenVersions: true,
        verifyByteIdentical: false,
        description: 'Re-execute every node from scratch on the same manifest + frozen versions.',
      });
    case 'rebuild':
      return freeze({
        mode,
        targetRun: 'new',
        scope: 'all',
        reusesManifest: true,
        reusesFrozenVersions: true,
        verifyByteIdentical: true,
        description:
          'Reproduce byte-identically from the frozen Version Matrix (verification path).',
      });
    case 'regenerate':
      return freeze({
        mode,
        targetRun: 'new',
        scope: 'all',
        reusesManifest: false,
        reusesFrozenVersions: false,
        verifyByteIdentical: false,
        description:
          'Re-derive the manifest under current versions — requires a new coordinator (seam).',
      });
    default:
      return assertNever(mode);
  }
}

function freeze(plan: ReplayPlan): ReplayPlan {
  return Object.freeze(plan);
}

/**
 * Seed a NEW run's initial state for a replay mode, given the prior run's (terminal) state.
 *
 * - `retry` carries forward every succeeded node (state + outputs + attempt counters) and
 *   resets everything else to `pending`, so only incomplete work re-runs.
 * - `replay`/`rebuild` produce a clean initial state (every node `pending`) on the same graph.
 * - `regenerate` cannot be seeded here — the manifest identity changes, so a new coordinator
 *   bound to the freshly-compiled manifest is required (returned as a `CoordinatorError` seam).
 */
export function seedReplay(
  graph: ExecutionGraph,
  priorState: ExecutionState,
  newRunId: RunId,
  mode: ReplayMode,
): Result<ExecutionState, CoordinatorError> {
  if (mode === 'regenerate') {
    return err(
      new CoordinatorError(
        'regenerate requires a NEW manifest (and coordinator); it cannot be seeded from the prior graph',
        { context: { mode } },
      ),
    );
  }
  if (mode === 'replay' || mode === 'rebuild') {
    return ok(initialExecutionState(graph, newRunId));
  }

  // retry: preserve succeeded nodes, reset the rest.
  const nodes: Record<string, NodeExecution> = {};
  for (const id of graph.order) {
    const prior = priorState.nodes[id];
    if (prior !== undefined && prior.state === 'succeeded' && prior.outputs !== undefined) {
      nodes[id] = {
        id,
        state: 'succeeded',
        attempt: prior.attempt,
        attempts: prior.attempts,
        outputs: prior.outputs,
      };
    } else {
      nodes[id] = { id, state: 'pending', attempt: 0, attempts: 0 };
    }
  }
  const seeded: ExecutionState = {
    runId: newRunId,
    pipelineId: graph.pipelineId,
    status: 'pending',
    nodes,
    seq: 0,
  };
  deepFreeze(seeded);
  return ok(seeded);
}
