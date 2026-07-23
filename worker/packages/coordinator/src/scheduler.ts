import type { StepId } from '@workerv2/processing';
import type { Timestamp } from '@workerv2/control-plane';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionState } from './execution-state.js';
import { isDue } from './time.js';

/**
 * The DEPENDENCY SCHEDULER + READY QUEUE — the deterministic decision surface for "what may
 * run next?". It is a pure QUERY over the graph + state + injected `now`: it never dispatches,
 * never mutates, never waits. Scheduling is deterministic for identical manifests because it
 * walks the graph's canonical order (the processing framework's Kahn ordering) — the same
 * graph and state always yield the same queue.
 *
 * An infrastructure adapter (single-process, distributed, queue-backed) consumes this queue to
 * decide how many nodes to actually start; the coordinator only advises. Retry backoff is
 * honoured without timers: a rescheduled node is `ready` but carries a future `readyAt`, so it
 * appears in `waiting` (not `dispatchable`) until an injected `now` reaches its `readyAt`.
 */

/** A ready node whose retry-backoff gate has not yet elapsed. */
export interface WaitingNode {
  readonly id: StepId;
  readonly readyAt: Timestamp;
}

/** The scheduler's advice at an instant. `dispatchable` is in canonical (deterministic) order. */
export interface ReadyQueue {
  /** Nodes eligible to start now (ready, backoff elapsed, run live), capped by `maxInFlight`. */
  readonly dispatchable: readonly StepId[];
  /** Ready nodes still gated by a future `readyAt` (retry backoff). */
  readonly waiting: readonly WaitingNode[];
  /** Nodes currently running (used to reason about concurrency capacity). */
  readonly running: number;
}

/** Optional, purely-declarative scheduling limits — no infrastructure implied. */
export interface SchedulingOptions {
  /** Maximum nodes the scheduler will mark dispatchable at once (default: unbounded). */
  readonly maxInFlight?: number;
}

/** Whether every dependency of `nodeId` has succeeded (the arming predicate). Pure. */
export function dependenciesSatisfied(
  graph: ExecutionGraph,
  state: ExecutionState,
  nodeId: string,
): boolean {
  const deps = graph.dependencies[nodeId] ?? [];
  for (const dep of deps) {
    if (state.nodes[dep]?.state !== 'succeeded') return false;
  }
  return true;
}

/**
 * Compute the ready queue for an instant. A run that is not `running`, or is draining
 * (`stopping`), dispatches nothing — its ready nodes are surfaced only as history, never as
 * work to start.
 */
export function computeReadyQueue(
  graph: ExecutionGraph,
  state: ExecutionState,
  now: Timestamp,
  options: SchedulingOptions = {},
): ReadyQueue {
  let running = 0;
  const eligible: StepId[] = [];
  const waiting: WaitingNode[] = [];

  for (const id of graph.order) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    if (node.state === 'running') running += 1;
    if (node.state !== 'ready') continue;
    const readyAt = node.readyAt;
    if (readyAt !== undefined && !isDue(readyAt, now)) {
      waiting.push({ id, readyAt });
    } else {
      eligible.push(id);
    }
  }

  const live = state.status === 'running' && state.stopping === undefined;
  if (!live) {
    return Object.freeze({ dispatchable: [], waiting: Object.freeze(waiting), running });
  }

  const capacity =
    options.maxInFlight === undefined
      ? eligible.length
      : Math.max(0, options.maxInFlight - running);
  const dispatchable = eligible.slice(0, capacity);
  return Object.freeze({
    dispatchable: Object.freeze(dispatchable),
    waiting: Object.freeze(waiting),
    running,
  });
}

/** Running nodes whose injected timeout deadline is at or before `now` (Timeout State query). */
export function dueTimeouts(
  graph: ExecutionGraph,
  state: ExecutionState,
  now: Timestamp,
): readonly StepId[] {
  const out: StepId[] = [];
  for (const id of graph.order) {
    const node = state.nodes[id];
    if (node === undefined || node.state !== 'running') continue;
    const attemptDue = node.attemptDeadline !== undefined && isDue(node.attemptDeadline, now);
    const overallDue = node.overallDeadline !== undefined && isDue(node.overallDeadline, now);
    if (attemptDue || overallDue) out.push(id);
  }
  return out;
}
