import type { StorageKey } from '@workerv2/infra-contracts';
import type { StepId } from '@workerv2/processing';
import type { StepFailure } from '@workerv2/processing';
import type { Timestamp } from '@workerv2/control-plane';
import { defineStateMachine } from '@workerv2/control-plane';

/**
 * The NODE LIFECYCLE — the per-node execution state machine the coordinator drives. Distinct
 * from the run lifecycle (`RUN_MACHINE`, reused from the Control Plane): a run is composed of
 * many nodes, each moving through its own lifecycle.
 *
 * - `pending`    — declared but not yet runnable (some dependency has not succeeded).
 * - `ready`      — every dependency has succeeded; eligible for dispatch once `readyAt` elapses
 *                  (retry backoff is expressed as a future `readyAt`, not a timer).
 * - `running`    — an attempt has been dispatched to a processor by an engine (not by us).
 * - `succeeded`  — the attempt produced every declared output (terminal).
 * - `failed`     — retries are exhausted or the failure was permanent (terminal).
 * - `cancelled`  — cancellation took effect for this node (terminal).
 * - `skipped`    — the run is failing/stopping and this node can never run (terminal).
 */
export type NodeState =
  'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export type NodeTrigger =
  | 'arm' // pending -> ready (dependencies satisfied)
  | 'dispatch' // ready -> running (an attempt begins)
  | 'succeed' // running -> succeeded
  | 'reschedule' // running -> ready (a retry with budget; backoff via readyAt)
  | 'fail' // running -> failed
  | 'cancel' // pending|ready|running -> cancelled
  | 'skip'; // pending|ready -> skipped

/** The node state machine: the authoritative set of legal per-node execution transitions. */
export const NODE_MACHINE = defineStateMachine<NodeState, NodeTrigger>({
  initial: 'pending',
  states: ['pending', 'ready', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'],
  terminal: ['succeeded', 'failed', 'cancelled', 'skipped'],
  transitions: [
    { from: 'pending', on: 'arm', to: 'ready' },
    { from: 'pending', on: 'cancel', to: 'cancelled' },
    { from: 'pending', on: 'skip', to: 'skipped' },
    { from: 'ready', on: 'dispatch', to: 'running' },
    { from: 'ready', on: 'cancel', to: 'cancelled' },
    { from: 'ready', on: 'skip', to: 'skipped' },
    { from: 'running', on: 'succeed', to: 'succeeded' },
    { from: 'running', on: 'reschedule', to: 'ready' },
    { from: 'running', on: 'fail', to: 'failed' },
    { from: 'running', on: 'cancel', to: 'cancelled' },
  ],
});

/** Terminal node states — a node in one of these will never change again. */
export const TERMINAL_NODE_STATES: readonly NodeState[] = [
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
];

export function isTerminalNodeState(state: NodeState): boolean {
  return NODE_MACHINE.isTerminal(state);
}

/**
 * The immutable execution record for one node. Deterministic by construction: every timestamp
 * is an injected value, and every derived field (`attemptDeadline`, `overallDeadline`, the
 * retry `readyAt`) is a pure offset of one. `outputs` is recorded on success so downstream
 * step-output bindings can be resolved into concrete artifact identities without re-execution.
 */
export interface NodeExecution {
  readonly id: StepId;
  readonly state: NodeState;
  /** 1-based number of the current (or most recent) attempt. */
  readonly attempt: number;
  /** Count of attempts that have been DISPATCHED (started). */
  readonly attempts: number;
  /** Earliest time this node may be dispatched — the retry-backoff gate (present when ready). */
  readonly readyAt?: Timestamp;
  /** When the first attempt began (anchors the overall-timeout budget). */
  readonly firstStartedAt?: Timestamp;
  /** When the current attempt began (anchors the per-attempt timeout budget). */
  readonly startedAt?: Timestamp;
  /** Injected deadline for the current attempt = startedAt + attemptTimeoutMs (Timeout State). */
  readonly attemptDeadline?: Timestamp;
  /** Injected deadline across all attempts = firstStartedAt + overallTimeoutMs. */
  readonly overallDeadline?: Timestamp;
  /** The most recent failure, if any (JSON-safe; drives the retry orchestrator). */
  readonly lastFailure?: StepFailure;
  /** Produced artifact identities (slot → content address), recorded on success. */
  readonly outputs?: Readonly<Record<string, StorageKey>>;
}

/** Why a run is winding down: a terminal node failed (`fail`) or cancellation was requested (`cancel`). */
export type StoppingReason = 'fail' | 'cancel';
