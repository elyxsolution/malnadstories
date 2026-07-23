import { describe, expect, it } from 'vitest';
import {
  NODE_MACHINE,
  applyJournalEntry,
  createCoordinator,
  dependenciesSatisfied,
  initialExecutionState,
  buildExecutionGraph,
} from '@workerv2/coordinator';
import type { JournalEntry } from '@workerv2/coordinator';
import { at, diamondPipeline, key, runId, unwrap, unwrapErr, versions } from './helpers.js';

function primed() {
  const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
  let state = coord.initialize(runId());
  state = unwrap(coord.start(state, { at: at(0) })).state;
  return { coord, state };
}

describe('dependency scheduler + ready queue', () => {
  it('arms only dependency-free nodes on start', () => {
    const { coord, state } = primed();
    const rq = coord.readyQueue(state, at(0));
    expect(rq.dispatchable).toEqual(['a']);
    expect(rq.waiting).toEqual([]);
    expect(state.nodes['b']?.state).toBe('pending');
  });

  it('surfaces mutually-independent nodes together, in canonical order', () => {
    const { coord } = primed();
    let state = primed().state;
    state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
    state = unwrap(coord.reportSuccess(state, 'a', { out: key('sha256:a') }, { at: at(1) })).state;
    expect(coord.readyQueue(state, at(1)).dispatchable).toEqual(['b', 'c']);
  });

  it('honours the declarative maxInFlight cap', () => {
    const coord = createCoordinator({
      pipeline: diamondPipeline(),
      versions: versions(),
      options: { maxInFlight: 1 },
    });
    let state = unwrap(coord.start(coord.initialize(runId()), { at: at(0) })).state;
    state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
    state = unwrap(coord.reportSuccess(state, 'a', { out: key('sha256:a') }, { at: at(1) })).state;
    const rq = coord.readyQueue(state, at(1));
    expect(rq.dispatchable).toEqual(['b']); // capped to one; c waits for capacity
    // Once b is running, no capacity remains.
    const busy = unwrap(coord.dispatch(state, 'b', { at: at(1) })).state;
    expect(coord.readyQueue(busy, at(1)).dispatchable).toEqual([]);
  });

  it('dispatches nothing before the run starts or while it is draining', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const pending = coord.initialize(runId());
    expect(coord.readyQueue(pending, at(0)).dispatchable).toEqual([]);
  });

  it('dependenciesSatisfied reflects upstream success', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    const state = initialExecutionState(graph, runId());
    expect(dependenciesSatisfied(graph, state, 'a')).toBe(true); // no deps
    expect(dependenciesSatisfied(graph, state, 'd')).toBe(false);
  });
});

describe('node lifecycle state machine', () => {
  it('encodes the legal per-node transitions and terminal states', () => {
    expect(NODE_MACHINE.canTransition('pending', 'arm')).toBe(true);
    expect(NODE_MACHINE.canTransition('ready', 'dispatch')).toBe(true);
    expect(NODE_MACHINE.canTransition('running', 'reschedule')).toBe(true);
    expect(NODE_MACHINE.canTransition('running', 'succeed')).toBe(true);
    expect(NODE_MACHINE.isTerminal('succeeded')).toBe(true);
    expect(NODE_MACHINE.isTerminal('skipped')).toBe(true);
    // A terminal node never moves again.
    expect(NODE_MACHINE.canTransition('succeeded', 'dispatch')).toBe(false);
  });
});

describe('journal fold guards (applyJournalEntry)', () => {
  it('rejects an out-of-order sequence number', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    const state = initialExecutionState(graph, runId());
    const forged: JournalEntry = { seq: 5, at: at(0), kind: 'run.started', to: 'running' };
    expect(unwrapErr(applyJournalEntry(graph, state, forged)).message).toContain('out of order');
  });

  it('rejects an illegal node transition (drift detection)', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    let state = initialExecutionState(graph, runId());
    state = unwrap(
      applyJournalEntry(graph, state, { seq: 0, at: at(0), kind: 'run.started', to: 'running' }),
    );
    // 'a' is pending; dispatching (ready -> running) is illegal from pending.
    const bad: JournalEntry = {
      seq: 1,
      at: at(0),
      kind: 'node.dispatched',
      node: 'a' as never,
      to: 'running',
    };
    expect(unwrapErr(applyJournalEntry(graph, state, bad)).message).toContain(
      'Illegal node transition',
    );
  });

  it('rejects a reference to an unknown node', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    let state = initialExecutionState(graph, runId());
    state = unwrap(
      applyJournalEntry(graph, state, { seq: 0, at: at(0), kind: 'run.started', to: 'running' }),
    );
    const bad: JournalEntry = {
      seq: 1,
      at: at(0),
      kind: 'node.armed',
      node: 'zzz' as never,
      to: 'ready',
    };
    expect(unwrapErr(applyJournalEntry(graph, state, bad)).message).toContain('unknown node');
  });
});
