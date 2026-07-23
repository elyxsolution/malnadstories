// @workerv2/execution-adapter — the infrastructure adapter that DRIVES the pure Coordinator.
// A tiny effect loop resolves processors, negotiates capabilities, invokes Processor.process(),
// feeds outcomes back into the Coordinator, persists journals through a replaceable interface,
// and publishes execution events through a replaceable sink. ALL side effects live here; the
// Coordinator stays pure and its decisions stay deterministic. NO processors, NO rendering, NO
// PDF, NO image processing, NO storage/DB/queue/network/R2 implementation, NO business logic.

// --- Errors ---
export { AdapterError } from './errors.js';

// --- Adapter contracts (replaceable seams) ---
export type { Clock, MutableClock, Waiter, JournalStore, EventSink } from './contracts.js';

// --- Time references ---
export { systemClock, manualClock, immediateWaiter, clockAdvancingWaiter } from './clock.js';

// --- Journal persistence (reference) ---
export { InMemoryJournalStore } from './journal-store.js';

// --- Event sinks (references) ---
export { InMemoryEventSink, noopEventSink, publisherSink } from './event-sink.js';

// --- Processor resolver ---
export { InMemoryProcessorRegistry } from './processor-registry.js';

// --- Capability negotiator (concrete impl of the runtime's reserved seam) ---
export {
  DefaultCapabilityNegotiator,
  defaultCapabilityNegotiator,
} from './capability-negotiator.js';

// --- Processor dispatcher ---
export { invokeProcessor } from './dispatcher.js';

// --- Execution session (applies each Coordinator step's side effects) ---
export { ExecutionSession } from './session.js';

// --- Tick driver ---
export { tickIfDue, nextWakeAt } from './tick-driver.js';

// --- Execution driver + effect loop ---
export type { DriveOptions, PumpResult } from './driver.js';
export { pump, runToCompletion, executeRun } from './driver.js';

// --- Execution validation (pre-flight gate) ---
export { validateExecutable } from './validate.js';
