import { describe, expect, it } from 'vitest';
import { stepFailure } from '@workerv2/processing';
import {
  AdapterError,
  DefaultCapabilityNegotiator,
  ExecutionSession,
  InMemoryEventSink,
  InMemoryJournalStore,
  InMemoryProcessorRegistry,
  defaultCapabilityNegotiator,
  invokeProcessor,
  nextWakeAt,
  tickIfDue,
  validateExecutable,
} from '@workerv2/execution-adapter';
import {
  at,
  diamondCoordinator,
  diamondRegistry,
  echoProcessor,
  key,
  manifestCoordinator,
  manifestOffers,
  manifestRegistry,
  runId,
  throwingProcessor,
  unwrapErr,
} from './helpers.js';

async function startedSession(coordinator = diamondCoordinator()) {
  const session = new ExecutionSession(
    coordinator,
    runId(),
    new InMemoryJournalStore(),
    new InMemoryEventSink(),
  );
  await session.start(at(0));
  return session;
}

describe('processor dispatcher', () => {
  it('returns a processor outcome unchanged', async () => {
    const session = await startedSession();
    const { context } = await session.dispatch('a', at(0));
    const outcome = await invokeProcessor(echoProcessor('p'), context);
    expect(outcome).toEqual({ ok: true, value: { outputs: { out: 'sha256:a-out' } } });
  });

  it('normalizes a thrown error into a transient failure (never crashes the loop)', async () => {
    const session = await startedSession();
    const { context } = await session.dispatch('a', at(0));
    const outcome = await invokeProcessor(throwingProcessor('p'), context);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe('transient');
    expect(outcome.error.message).toContain('threw');
  });
});

describe('processor resolver (registry)', () => {
  it('resolves by name and version policy (exact / wildcard / undefined)', () => {
    const registry = new InMemoryProcessorRegistry().register(echoProcessor('p', '2.0.0'));
    expect(registry.resolve('p')?.descriptor.version).toBe('2.0.0');
    expect(registry.resolve('p', '2.0.0')).not.toBeNull();
    expect(registry.resolve('p', '*')).not.toBeNull();
    expect(registry.resolve('p', '1.0.0')).toBeNull();
    expect(registry.resolve('missing')).toBeNull();
  });

  it('rejects a duplicate registration', () => {
    const registry = new InMemoryProcessorRegistry().register(echoProcessor('p'));
    expect(() => registry.register(echoProcessor('p'))).toThrow(AdapterError);
  });
});

describe('capability negotiator', () => {
  const negotiator = new DefaultCapabilityNegotiator();

  it('is satisfied when every requirement is offered', () => {
    const result = negotiator.negotiate(
      [{ name: 'render.surface' }],
      [{ name: 'render.surface', version: '1.0.0' }],
    );
    expect(result.satisfied).toBe(true);
    expect(result.matched).toHaveLength(1);
  });

  it('honours the version policy and reports unmet requirements', () => {
    expect(
      negotiator.negotiate(
        [{ name: 'x', versionRange: '1.0.0' }],
        [{ name: 'x', version: '2.0.0' }],
      ).satisfied,
    ).toBe(false);
    expect(
      negotiator.negotiate([{ name: 'x', versionRange: '*' }], [{ name: 'x', version: '9' }])
        .satisfied,
    ).toBe(true);
    const unmet = negotiator.negotiate([{ name: 'y' }], []);
    expect(unmet.satisfied).toBe(false);
    expect(unmet.unmet.map((u) => u.name)).toEqual(['y']);
  });

  it('is trivially satisfied with no requirements', () => {
    expect(negotiator.negotiate([], []).satisfied).toBe(true);
  });
});

describe('execution validation (pre-flight)', () => {
  it('accepts a fully-wired run', () => {
    const coordinator = diamondCoordinator();
    expect(
      validateExecutable(coordinator, diamondRegistry(), defaultCapabilityNegotiator, []).ok,
    ).toBe(true);
  });

  it('rejects a missing processor', () => {
    const coordinator = diamondCoordinator();
    const error = unwrapErr(
      validateExecutable(
        coordinator,
        new InMemoryProcessorRegistry(),
        defaultCapabilityNegotiator,
        [],
      ),
    );
    expect(error.message).toContain('Processor resolution failed');
  });

  it('rejects unmet capabilities (manifest with no offers)', () => {
    const coordinator = manifestCoordinator();
    const error = unwrapErr(
      validateExecutable(coordinator, manifestRegistry(), defaultCapabilityNegotiator, []),
    );
    expect(error.message).toContain('Unmet capabilities');
  });

  it('accepts a manifest run with the right offers', () => {
    const coordinator = manifestCoordinator();
    expect(
      validateExecutable(
        coordinator,
        manifestRegistry(),
        defaultCapabilityNegotiator,
        manifestOffers(),
      ).ok,
    ).toBe(true);
  });
});

describe('tick driver', () => {
  it('nextWakeAt reports the earliest future retry backoff', async () => {
    const coordinator = diamondCoordinator({
      maxAttempts: 2,
      backoff: 'fixed',
      initialDelayMs: 1000,
    });
    const session = await startedSession(coordinator);
    await session.dispatch('a', at(0));
    await session.reportSuccess('a', { out: key('sha256:a') }, at(0));
    await session.dispatch('b', at(0));
    await session.reportFailure('b', stepFailure('transient', 'x'), at(0));

    expect(coordinator.progress(session.state).byState.ready).toBeGreaterThan(0);
    expect(nextWakeAt(coordinator, session.state, at(0))).toBe(at(1000));
  });

  it('tickIfDue does nothing when no timeout is due', async () => {
    const session = await startedSession();
    expect(await tickIfDue(session, at(0))).toBeNull();
  });
});

describe('execution session', () => {
  it('advances state, persists the journal, and publishes events on start', async () => {
    const journal = new InMemoryJournalStore();
    const events = new InMemoryEventSink();
    const session = new ExecutionSession(diamondCoordinator(), runId(), journal, events);
    await session.start(at(0));
    expect(session.state.status).toBe('running');
    expect((await journal.load(runId())).length).toBeGreaterThan(0);
    expect(events.events[0]?.type).toBe('execution.run.started');
  });

  it('surfaces a coordinator rejection as an AdapterError', async () => {
    const session = await startedSession();
    // 'd' is pending (deps unmet) — dispatching it is illegal.
    await expect(session.dispatch('d', at(0))).rejects.toBeInstanceOf(AdapterError);
  });
});
