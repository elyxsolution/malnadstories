import type { Timestamp } from '@workerv2/control-plane';
import { compareTimestamps } from '@workerv2/control-plane';
import type { Coordinator, CoordinatorStep, ExecutionState } from '@workerv2/coordinator';
import type { ExecutionSession } from './session.js';

/**
 * The TICK DRIVER — the adapter's TIME advancement helpers, kept out of the effect loop so the
 * loop stays tiny. The Coordinator arms no timer; the adapter reads an injected clock and, when
 * the clock has reached a node's deadline, drives a `tick` (which the Coordinator turns into a
 * `timeout` failure through the shared retry orchestrator). `nextWakeAt` reports the earliest
 * future instant at which driving again could make progress — a retry-backoff `readyAt` that has
 * not elapsed, or a running node's timeout deadline — so a host knows when to resume without
 * polling.
 */

/** Tick the session if any running node's timeout budget has elapsed; else do nothing. */
export async function tickIfDue(
  session: ExecutionSession,
  now: Timestamp,
): Promise<CoordinatorStep | null> {
  if (session.coordinator.dueTimeouts(session.state, now).length === 0) return null;
  return session.tick(now);
}

/**
 * The earliest future timestamp at which driving again could progress the run: the soonest
 * un-elapsed retry `readyAt` (a waiting node) or running timeout deadline strictly after `now`.
 * `undefined` when nothing is time-gated (the run is either dispatchable now or has no pending
 * time-based work). Pure.
 */
export function nextWakeAt(
  coordinator: Coordinator,
  state: ExecutionState,
  now: Timestamp,
): Timestamp | undefined {
  let earliest: Timestamp | undefined;
  const consider = (candidate: Timestamp | undefined): void => {
    if (candidate === undefined) return;
    if (compareTimestamps(candidate, now) <= 0) return; // already elapsed — not a future wake
    if (earliest === undefined || compareTimestamps(candidate, earliest) < 0) earliest = candidate;
  };

  for (const id of coordinator.graph.order) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    if (node.state === 'ready') consider(node.readyAt);
    if (node.state === 'running') {
      consider(node.attemptDeadline);
      consider(node.overallDeadline);
    }
  }
  return earliest;
}
