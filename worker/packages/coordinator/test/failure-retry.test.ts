import { describe, expect, it } from 'vitest';
import { stepFailure } from '@workerv2/processing';
import { createCoordinator, progressOf } from '@workerv2/coordinator';
import type { Coordinator, ExecutionState } from '@workerv2/coordinator';
import { at, diamondPipeline, key, runId, unwrap, versions } from './helpers.js';

/** Drive to the point where A has succeeded and B is dispatchable (B/C armed). */
function afterADone(coord: Coordinator): ExecutionState {
  let state = unwrap(coord.start(coord.initialize(runId()), { at: at(0) })).state;
  state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
  return unwrap(coord.reportSuccess(state, 'a', { out: key('sha256:a') }, { at: at(0) })).state;
}

describe('retry orchestrator', () => {
  it('reschedules a transient failure with backoff expressed as a future readyAt', () => {
    const coord = createCoordinator({
      pipeline: diamondPipeline({
        retryB: { maxAttempts: 2, backoff: 'fixed', initialDelayMs: 1000 },
      }),
      versions: versions(),
    });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
    state = unwrap(
      coord.reportFailure(state, 'b', stepFailure('transient', 'hiccup'), { at: at(0) }),
    ).state;

    expect(state.nodes['b']?.state).toBe('ready');
    expect(state.nodes['b']?.attempt).toBe(2);
    expect(state.nodes['b']?.readyAt).toBe(at(1000));
    expect(state.nodes['b']?.lastFailure?.kind).toBe('transient');

    // Backoff gate: not dispatchable now, but waiting; dispatchable once now reaches readyAt.
    expect(coord.readyQueue(state, at(0)).waiting.map((w) => w.id)).toContain('b');
    expect(coord.readyQueue(state, at(0)).dispatchable).not.toContain('b');
    expect(coord.readyQueue(state, at(1000)).dispatchable).toContain('b');

    const retryDispatch = unwrap(coord.dispatch(state, 'b', { at: at(1000) }));
    expect(retryDispatch.context.attempt).toBe(2);
  });

  it('fails fast when the retry budget is exhausted, skipping the rest of the graph', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
    state = unwrap(
      coord.reportFailure(state, 'b', stepFailure('transient', 'boom'), { at: at(0) }),
    ).state;

    expect(state.status).toBe('failed');
    expect(state.stopping).toBe('fail');
    expect(state.nodes['b']?.state).toBe('failed');
    expect(state.nodes['c']?.state).toBe('skipped');
    expect(state.nodes['d']?.state).toBe('skipped');
    expect(progressOf(state).settled).toBe(true);
  });

  it('never retries a permanent failure, even with budget remaining', () => {
    const coord = createCoordinator({
      pipeline: diamondPipeline({
        retryB: { maxAttempts: 5, backoff: 'fixed', initialDelayMs: 1000 },
      }),
      versions: versions(),
    });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
    state = unwrap(
      coord.reportFailure(state, 'b', stepFailure('permanent', 'bad input'), { at: at(0) }),
    ).state;
    expect(state.nodes['b']?.state).toBe('failed');
    expect(state.status).toBe('failed');
  });
});

describe('timeout state tracking (no timers — time is injected via tick)', () => {
  it('records deadlines on dispatch and converts an elapsed budget into a failure', () => {
    const coord = createCoordinator({
      pipeline: diamondPipeline({
        retryB: { maxAttempts: 2, backoff: 'fixed', initialDelayMs: 1000 },
        timeoutB: { attemptTimeoutMs: 1000 },
      }),
      versions: versions(),
    });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
    expect(state.nodes['b']?.attemptDeadline).toBe(at(1000));

    expect(coord.dueTimeouts(state, at(500))).toEqual([]);
    expect(coord.dueTimeouts(state, at(1000))).toEqual(['b']);

    // A tick before the deadline changes nothing; a tick at the deadline retries via the orchestrator.
    expect(unwrap(coord.tick(state, { at: at(500) })).entries).toHaveLength(0);
    const ticked = unwrap(coord.tick(state, { at: at(1000) }));
    expect(ticked.state.nodes['b']?.state).toBe('ready');
    expect(ticked.state.nodes['b']?.attempt).toBe(2);
    expect(ticked.state.nodes['b']?.lastFailure?.kind).toBe('timeout');
  });
});
