import { describe, expect, it } from 'vitest';
import {
  ExecutionSession,
  InMemoryEventSink,
  InMemoryJournalStore,
  defaultCapabilityNegotiator,
  executeRun,
  manualClock,
  runToCompletion,
} from '@workerv2/execution-adapter';
import {
  at,
  diamondCoordinator,
  diamondRegistry,
  manifestCoordinator,
  manifestOffers,
  manifestRegistry,
  runId,
} from './helpers.js';

describe('execution driver — end to end', () => {
  it('drives a diamond pipeline to a succeeded run, persisting the journal and publishing events', async () => {
    const coordinator = diamondCoordinator();
    const journal = new InMemoryJournalStore();
    const events = new InMemoryEventSink();

    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal,
      events,
      options: {
        clock: manualClock(at(0)),
        resolver: diamondRegistry(),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });

    expect(state.status).toBe('succeeded');
    expect(coordinator.progress(state).succeeded).toBe(4);
    // The recorded outputs came from the injected echo processor.
    expect(state.nodes['d']?.outputs).toEqual({ album: 'sha256:d-album' });

    // The persisted journal reconstructs the exact driven state (the adapter changed no decisions).
    const persisted = await journal.load(runId());
    expect(coordinator.resume(runId(), persisted)).toEqual({ ok: true, value: state });
    expect(coordinator.validate(state).ok).toBe(true);

    // One event was published per journal entry, first is the run start, last the run success.
    expect(events.events).toHaveLength(persisted.length);
    expect(events.events[0]?.type).toBe('execution.run.started');
    expect(events.events.at(-1)?.type).toBe('execution.run.succeeded');
  });

  it('drives a Manifest run (with capability negotiation) to completion', async () => {
    const coordinator = manifestCoordinator();
    const journal = new InMemoryJournalStore();

    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal,
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at(0)),
        resolver: manifestRegistry(),
        negotiator: defaultCapabilityNegotiator,
        offers: manifestOffers(),
      },
    });

    expect(state.status).toBe('succeeded');
    expect(state.nodes['assemble:album']?.state).toBe('succeeded');
    const persisted = await journal.load(runId());
    expect(coordinator.resume(runId(), persisted)).toEqual({ ok: true, value: state });
  });

  it('produces a deterministic journal — identical across runs', async () => {
    const drive = async () => {
      const coordinator = diamondCoordinator();
      const journal = new InMemoryJournalStore();
      await executeRun({
        coordinator,
        runId: runId(),
        journal,
        events: new InMemoryEventSink(),
        options: {
          clock: manualClock(at(0)),
          resolver: diamondRegistry(),
          negotiator: defaultCapabilityNegotiator,
          offers: [],
        },
      });
      return journal.load(runId());
    };
    const a = await drive();
    const b = await drive();
    expect(a).toEqual(b);
    // Canonical command sequence (kinds), independent of the effect layer.
    expect(a.map((e) => e.kind)).toEqual([
      'run.started',
      'node.armed', // a
      'node.dispatched', // a
      'node.succeeded', // a
      'node.armed', // b
      'node.armed', // c
      'node.dispatched', // b
      'node.succeeded', // b
      'node.dispatched', // c
      'node.succeeded', // c
      'node.armed', // d
      'node.dispatched', // d
      'node.succeeded', // d
      'run.succeeded',
    ]);
  });

  it('resumes a persisted journal and continues to completion', async () => {
    const coordinator = diamondCoordinator();
    const journal = new InMemoryJournalStore();
    // Drive only the first node by hand, persisting through a session.
    const session = new ExecutionSession(coordinator, runId(), journal, new InMemoryEventSink());
    await session.start(at(0));
    const dispatched = await session.dispatch('a', at(0));
    await session.reportSuccess(
      'a',
      { out: dispatched.context.inputs['seed'] ?? ('sha256:x' as never) },
      at(0),
    );

    // Rebuild a fresh session from the persisted journal and finish it.
    const resumedState = coordinator.resume(runId(), await journal.load(runId()));
    expect(resumedState.ok).toBe(true);
    if (!resumedState.ok) return;

    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal,
      events: new InMemoryEventSink(),
      initial: resumedState.value,
      options: {
        clock: manualClock(at(0)),
        resolver: diamondRegistry(),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });
    expect(state.status).toBe('succeeded');
    // 'a' was NOT re-run (its attempt count stayed at 1).
    expect(state.nodes['a']?.attempts).toBe(1);
  });
});

describe('runToCompletion is a no-op on an already-settled run', () => {
  it('returns the terminal state without dispatching', async () => {
    const coordinator = diamondCoordinator();
    const journal = new InMemoryJournalStore();
    const { session, state } = await executeRun({
      coordinator,
      runId: runId(),
      journal,
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at(0)),
        resolver: diamondRegistry(),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });
    const before = (await journal.load(runId())).length;
    const again = await runToCompletion(session, {
      clock: manualClock(at(0)),
      resolver: diamondRegistry(),
      negotiator: defaultCapabilityNegotiator,
      offers: [],
    });
    expect(again).toEqual(state);
    expect((await journal.load(runId())).length).toBe(before);
  });
});
