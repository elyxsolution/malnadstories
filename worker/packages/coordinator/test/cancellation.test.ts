import { describe, expect, it } from 'vitest';
import { stepFailure } from '@workerv2/processing';
import { createCoordinator } from '@workerv2/coordinator';
import type { Coordinator, ExecutionState } from '@workerv2/coordinator';
import { at, diamondPipeline, key, runId, unwrap, unwrapErr, versions } from './helpers.js';

function afterADone(coord: Coordinator): ExecutionState {
  let state = unwrap(coord.start(coord.initialize(runId()), { at: at(0) })).state;
  state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
  return unwrap(coord.reportSuccess(state, 'a', { out: key('sha256:a') }, { at: at(0) })).state;
}

describe('cancellation propagation', () => {
  it('cancels un-started work immediately and finalizes once nothing is running', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state; // b running

    const cancelled = unwrap(coord.requestCancellation(state, { at: at(1) }, 'user aborted'));
    state = cancelled.state;
    expect(state.stopping).toBe('cancel');
    expect(state.cancellationReason).toBe('user aborted');
    expect(state.nodes['c']?.state).toBe('cancelled'); // was ready
    expect(state.nodes['d']?.state).toBe('cancelled'); // was pending
    expect(state.nodes['b']?.state).toBe('running'); // in-flight, not yet reported
    expect(state.status).toBe('running'); // still draining

    // Once the in-flight node reports (here: a cancellation outcome), the run finalizes.
    const drained = unwrap(
      coord.reportFailure(state, 'b', stepFailure('cancelled', 'aborted'), { at: at(2) }),
    );
    expect(drained.state.nodes['b']?.state).toBe('cancelled');
    expect(drained.state.status).toBe('cancelled');
  });

  it('finalizes immediately when no node is running', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const started = unwrap(coord.start(coord.initialize(runId()), { at: at(0) }));
    const cancelled = unwrap(coord.requestCancellation(started.state, { at: at(1) }));
    expect(cancelled.state.status).toBe('cancelled');
    expect(Object.values(cancelled.state.nodes).every((n) => n.state === 'cancelled')).toBe(true);
  });

  it('a node self-reporting cancellation drains the run even without a prior request', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = afterADone(coord);
    state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
    const res = unwrap(
      coord.reportFailure(state, 'b', stepFailure('cancelled', 'signal observed'), { at: at(1) }),
    );
    expect(res.state.stopping).toBe('cancel');
    expect(res.state.status).toBe('cancelled');
    expect(res.state.nodes['c']?.state).toBe('cancelled');
  });

  it('cannot cancel a run that has already settled', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const started = unwrap(coord.start(coord.initialize(runId()), { at: at(0) }));
    const cancelled = unwrap(coord.requestCancellation(started.state, { at: at(1) }));
    expect(unwrapErr(coord.requestCancellation(cancelled.state, { at: at(2) })).message).toContain(
      'Cannot cancel',
    );
  });
});
