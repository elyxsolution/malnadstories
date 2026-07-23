// @workerv2/coordinator — the Coordinator Platform: the deterministic execution coordinator
// that orchestrates Manifest/Pipeline execution WITHOUT performing any processing itself.
// Execution-state model, run + node state machines, deterministic dependency scheduler + ready
// queue, retry/timeout/cancellation orchestration over the declarative Processing policies,
// progress model, append-only event-sourced execution journal, execution-event publication
// contracts, resume + replay models, and coordinator validation. Pure data + pure functions —
// NO processor execution, NO rendering/PDF/image, NO storage/queue/network, NO timers (time is
// injected). Infrastructure adapters DRIVE it through the public API; it changes for none.

// --- Errors ---
export { CoordinatorError } from './errors.js';

// --- Time (injected; no ambient clock, no timers) ---
export { addMillis, isDue } from './time.js';

// --- Node lifecycle (per-node state machine) ---
export type { NodeState, NodeTrigger, NodeExecution, StoppingReason } from './node-state.js';
export { NODE_MACHINE, TERMINAL_NODE_STATES, isTerminalNodeState } from './node-state.js';

// --- Run state machine (reused from the Control Plane — the source of truth) ---
export type { RunState, RunTrigger } from '@workerv2/control-plane';
export { RUN_MACHINE, ACTIVE_RUN_STATES, isActiveRunState } from '@workerv2/control-plane';

// --- Execution graph (topology derived once from a validated pipeline) ---
export type { ExecutionGraph } from './graph.js';
export { buildExecutionGraph, graphNodeIds } from './graph.js';

// --- Execution state model ---
export type { ExecutionState } from './execution-state.js';
export {
  initialExecutionState,
  nodeExecution,
  nodeExecutions,
  runningNodeIds,
} from './execution-state.js';

// --- Execution journal (append-only; the single state-mutation path) ---
export type { JournalKind, JournalEntry, JournalEntrySpec } from './journal.js';
export { applyJournalEntry } from './journal.js';

// --- Event publication contracts ---
export type { ExecutionEventType, ExecutionEvent, ExecutionEventPublisher } from './events.js';
export { toExecutionEvent, toExecutionEvents } from './events.js';

// --- Progress model ---
export type { ExecutionProgress } from './progress.js';
export { progressOf } from './progress.js';

// --- Dependency scheduler + ready queue ---
export type { ReadyQueue, WaitingNode, SchedulingOptions } from './scheduler.js';
export { computeReadyQueue, dueTimeouts, dependenciesSatisfied } from './scheduler.js';

// --- Context resolution + processor acceptance (build contexts; never execute) ---
export { resolveInputs, buildProcessingContext, validateProcessors } from './context.js';

// --- Transitions (the deterministic command reducer) ---
export type { CoordinatorContext, CoordinatorStep, DispatchResult } from './transitions.js';
export {
  startRun,
  dispatchNode,
  reportSuccess,
  reportFailure,
  requestCancellation,
  tick,
} from './transitions.js';

// --- Resume model ---
export { resumeFromJournal, isResumable } from './resume.js';

// --- Replay model (Retry / Replay / Rebuild / Regenerate) ---
export type { ReplayMode, ReplayRequest, ReplayPlan } from './replay.js';
export { REPLAY_MODES, describeReplay, seedReplay } from './replay.js';

// --- Coordinator validation (untrusted-state gate) ---
export { validateExecutionState } from './validate.js';

// --- Coordinator façade ---
export type { Coordinator, CoordinatorOptions, CoordinatorSetup } from './coordinator.js';
export { createCoordinator, coordinatorFromManifest } from './coordinator.js';
