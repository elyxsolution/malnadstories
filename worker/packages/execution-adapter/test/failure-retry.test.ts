import { describe, expect, it } from 'vitest';
import {
  InMemoryEventSink,
  InMemoryJournalStore,
  clockAdvancingWaiter,
  defaultCapabilityNegotiator,
  executeRun,
  manualClock,
} from '@workerv2/execution-adapter';
import {
  at,
  diamondCoordinator,
  diamondRegistry,
  manifestCoordinator,
  manifestRegistry,
  runId,
  scriptedProcessor,
  throwingProcessor,
} from './helpers.js';

describe('failure handling through the coordinator (adapter adds no policy)', () => {
  it('retries a transient failure with backoff and eventually succeeds', async () => {
    const coordinator = diamondCoordinator({
      maxAttempts: 3,
      backoff: 'fixed',
      initialDelayMs: 1000,
    });
    const clock = manualClock(at(0));
    const journal = new InMemoryJournalStore();

    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal,
      events: new InMemoryEventSink(),
      options: {
        clock,
        waiter: clockAdvancingWaiter(clock), // advance the clock over each backoff, deterministically
        resolver: diamondRegistry(scriptedProcessor('p', { b: { fail: 2, kind: 'transient' } })),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });

    expect(state.status).toBe('succeeded');
    expect(state.nodes['b']?.attempts).toBe(3); // 2 failures + 1 success
    const persisted = await journal.load(runId());
    expect(persisted.filter((e) => e.kind === 'node.retry-scheduled')).toHaveLength(2);
  });

  it('fails the run (fail-fast) on a permanent failure and skips the rest', async () => {
    const coordinator = diamondCoordinator();
    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal: new InMemoryJournalStore(),
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at(0)),
        resolver: diamondRegistry(scriptedProcessor('p', { b: { fail: 99, kind: 'permanent' } })),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });
    expect(state.status).toBe('failed');
    expect(state.nodes['b']?.state).toBe('failed');
    expect(state.nodes['c']?.state).toBe('skipped');
    expect(state.nodes['d']?.state).toBe('skipped');
  });

  it('normalizes a thrown processor into a transient failure', async () => {
    const coordinator = diamondCoordinator();
    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal: new InMemoryJournalStore(),
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at(0)),
        resolver: diamondRegistry(throwingProcessor('p')),
        negotiator: defaultCapabilityNegotiator,
        offers: [],
      },
    });
    // 'a' throws → transient → NO_RETRY budget exhausts → run fails fast.
    expect(state.status).toBe('failed');
    expect(state.nodes['a']?.state).toBe('failed');
    expect(state.nodes['a']?.lastFailure?.kind).toBe('transient');
  });

  it('permanently fails a node whose required capability is not offered', async () => {
    const coordinator = manifestCoordinator();
    const { state } = await executeRun({
      coordinator,
      runId: runId(),
      journal: new InMemoryJournalStore(),
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at(0)),
        resolver: manifestRegistry(),
        negotiator: defaultCapabilityNegotiator,
        offers: [], // no render/assemble capability offered
      },
    });
    expect(state.status).toBe('failed');
    const failed = Object.values(state.nodes).find((n) => n.state === 'failed');
    expect(failed?.lastFailure?.kind).toBe('permanent');
    expect(failed?.lastFailure?.message).toContain('Unmet capabilities');
  });
});
