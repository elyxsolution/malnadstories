import type {
  CancellationSignal,
  ProcessorResolver,
  StepCapabilityRequirement,
} from '@workerv2/processing';
import { stepFailure } from '@workerv2/processing';
import type {
  CapabilityNegotiator,
  CapabilityOffer,
  CapabilityRequirement,
} from '@workerv2/runtime';
import type { RunId, Timestamp } from '@workerv2/control-plane';
import type { Coordinator, ExecutionState } from '@workerv2/coordinator';
import type { Clock, EventSink, JournalStore, Waiter } from './contracts.js';
import { immediateWaiter } from './clock.js';
import { ExecutionSession } from './session.js';
import { invokeProcessor } from './dispatcher.js';
import { nextWakeAt, tickIfDue } from './tick-driver.js';
import { AdapterError } from './errors.js';

/**
 * The EXECUTION DRIVER + EFFECT LOOP — the small, side-effecting heart of the adapter. It is
 * intentionally tiny and sequential so it is easy to reason about: per sweep it (1) turns
 * elapsed timeout budgets into failures, (2) asks the pure Coordinator which nodes are
 * dispatchable NOW, and (3) for each, in canonical order, negotiates capabilities, resolves the
 * processor, dispatches (→ a resolved `ProcessingContext`), INVOKES the processor, and feeds the
 * outcome back. Between sweeps it waits out retry backoff. The Coordinator makes every decision;
 * the loop only performs effects — so the run's journal is deterministic and identical to what
 * the pure Coordinator produces given the same injected times.
 */

/** Everything the driver needs from its environment — all replaceable seams. */
export interface DriveOptions {
  readonly clock: Clock;
  readonly resolver: ProcessorResolver;
  readonly negotiator: CapabilityNegotiator;
  /** Capabilities the host OFFERS, negotiated against each node's requirements before dispatch. */
  readonly offers: readonly CapabilityOffer[];
  /** How to wait out retry backoff between sweeps (default: return immediately). */
  readonly waiter?: Waiter;
  /** Optional external cancellation signal handed to each dispatched processor's context. */
  readonly cancellation?: CancellationSignal;
  /** Safety bound on sweeps (default 10000) — a stuck run returns rather than looping forever. */
  readonly maxSweeps?: number;
}

/** The result of one effect-loop sweep. */
export interface PumpResult {
  readonly settled: boolean;
  /** How many nodes were dispatched this sweep. */
  readonly dispatched: number;
  /** Earliest future instant at which driving again could progress (retry backoff / timeout). */
  readonly nextWakeAt?: Timestamp;
}

/**
 * One EFFECT-LOOP sweep at the injected `now`: tick due timeouts, then dispatch every
 * currently-dispatchable node (serially, in canonical order) and feed each outcome back. Returns
 * whether the run settled, how many nodes ran, and the next time-gated wake instant. Nodes that
 * a fail-fast skipped mid-sweep are silently passed over.
 */
export async function pump(
  session: ExecutionSession,
  options: DriveOptions,
  now: Timestamp,
): Promise<PumpResult> {
  await tickIfDue(session, now);

  let dispatched = 0;
  const ready = session.coordinator.readyQueue(session.state, now);
  for (const id of ready.dispatchable) {
    if (session.state.nodes[id]?.state !== 'ready') continue; // skipped by a fail-fast this sweep
    await dispatchNode(session, id, options, now);
    dispatched += 1;
    if (session.settled) break;
  }

  const wake = nextWakeAt(session.coordinator, session.state, now);
  return {
    settled: session.settled,
    dispatched,
    ...(wake === undefined ? {} : { nextWakeAt: wake }),
  };
}

/**
 * Drive a run to completion (or to a time-gated pause it waits out). Starts a pending run, then
 * pumps until the run settles. The Coordinator's decisions are untouched — the driver only
 * chooses WHEN to feed the next injected `now` and performs the effects.
 */
export async function runToCompletion(
  session: ExecutionSession,
  options: DriveOptions,
): Promise<ExecutionState> {
  if (session.state.status === 'pending') {
    await session.start(options.clock.now());
  }
  const waiter = options.waiter ?? immediateWaiter;
  const maxSweeps = options.maxSweeps ?? 10_000;

  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    if (session.settled) break;
    const now = options.clock.now();
    const result = await pump(session, options, now);
    if (result.settled) break;
    if (result.dispatched === 0) {
      if (result.nextWakeAt === undefined) break; // nothing dispatchable and nothing time-gated
      await waiter.waitUntil(result.nextWakeAt, now);
    }
  }
  return session.state;
}

/** Create a session and drive its run to completion in one call. */
export async function executeRun(input: {
  readonly coordinator: Coordinator;
  readonly runId: RunId;
  readonly journal: JournalStore;
  readonly events: EventSink;
  readonly options: DriveOptions;
  /** A resumed state to continue from (its journal already persisted); omit to start fresh. */
  readonly initial?: ExecutionState;
}): Promise<{ state: ExecutionState; session: ExecutionSession }> {
  const session = new ExecutionSession(
    input.coordinator,
    input.runId,
    input.journal,
    input.events,
    input.initial,
  );
  const state = await runToCompletion(session, input.options);
  return { state, session };
}

/**
 * Negotiate + resolve + dispatch + invoke + report for one node. Capability negotiation happens
 * BEFORE dispatch; an unmet capability or unresolved processor becomes a PERMANENT step failure
 * (recorded as an attempt so the run fails deterministically) — the Coordinator's fail-fast then
 * takes over. The processor is invoked exactly once; its outcome is fed straight back.
 */
async function dispatchNode(
  session: ExecutionSession,
  nodeId: string,
  options: DriveOptions,
  now: Timestamp,
): Promise<void> {
  const step = session.coordinator.graph.nodes[nodeId];
  if (step === undefined) {
    throw new AdapterError(`Driver asked to dispatch unknown node "${nodeId}"`, {
      context: { node: nodeId },
    });
  }

  const required: readonly CapabilityRequirement[] =
    step.requires as readonly StepCapabilityRequirement[];
  const negotiation = options.negotiator.negotiate(required, options.offers);
  const processor = negotiation.satisfied
    ? options.resolver.resolve(step.processor, step.processorVersionRange)
    : null;

  // Dispatch first (records the attempt + resolves inputs); NO processor runs on the failure paths.
  const dispatched = await session.dispatch(nodeId, now, options.cancellation);

  if (!negotiation.satisfied) {
    const names = negotiation.unmet.map((u) => u.name);
    await session.reportFailure(
      nodeId,
      stepFailure('permanent', `Unmet capabilities for "${nodeId}": ${names.join(', ')}`, {
        unmet: names,
      }),
      options.clock.now(),
    );
    return;
  }
  if (processor === null) {
    await session.reportFailure(
      nodeId,
      stepFailure('permanent', `No processor registered for "${step.processor}"`, {
        processor: step.processor,
      }),
      options.clock.now(),
    );
    return;
  }

  const outcome = await invokeProcessor(processor, dispatched.context);
  if (outcome.ok) {
    await session.reportSuccess(nodeId, outcome.value.outputs, options.clock.now());
  } else {
    await session.reportFailure(nodeId, outcome.error, options.clock.now());
  }
}
