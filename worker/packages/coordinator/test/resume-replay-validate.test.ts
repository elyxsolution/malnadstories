import { describe, expect, it } from 'vitest';
import { stepFailure } from '@workerv2/processing';
import {
  REPLAY_MODES,
  buildExecutionGraph,
  createCoordinator,
  describeReplay,
  initialExecutionState,
  isResumable,
  validateExecutionState,
} from '@workerv2/coordinator';
import type { Coordinator, ExecutionState, JournalEntry } from '@workerv2/coordinator';
import {
  at,
  diamondPipeline,
  driveToCompletion,
  key,
  runId,
  unwrap,
  unwrapErr,
  versions,
} from './helpers.js';

function failedRun(coord: Coordinator): ExecutionState {
  let state = unwrap(coord.start(coord.initialize(runId()), { at: at(0) })).state;
  state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
  state = unwrap(coord.reportSuccess(state, 'a', { out: key('sha256:a') }, { at: at(0) })).state;
  state = unwrap(coord.dispatch(state, 'b', { at: at(0) })).state;
  return unwrap(coord.reportFailure(state, 'b', stepFailure('transient', 'boom'), { at: at(0) }))
    .state;
}

describe('resume model (event-sourced, no drift)', () => {
  it('rebuilds the exact terminal state by re-folding the journal', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const { state, journal } = driveToCompletion(coord, at(0));
    const resumed = unwrap(coord.resume(runId(), journal));
    expect(resumed).toEqual(state);
  });

  it('rebuilds an interrupted (partial) run identically', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const started = unwrap(coord.start(coord.initialize(runId()), { at: at(0) }));
    const dispatched = unwrap(coord.dispatch(started.state, 'a', { at: at(0) }));
    const journal: JournalEntry[] = [...started.entries, ...dispatched.entries];
    const resumed = unwrap(coord.resume(runId(), journal));
    expect(resumed).toEqual(dispatched.state);
    expect(isResumable(resumed)).toBe(true);
  });

  it('rejects a tampered journal (out-of-order sequence)', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const { journal } = driveToCompletion(coord, at(0));
    const swapped = [journal[1], journal[0], ...journal.slice(2)] as JournalEntry[];
    expect(unwrapErr(coord.resume(runId(), swapped)).message).toContain('out of order');
  });
});

describe('replay model (Retry / Replay / Rebuild / Regenerate semantics)', () => {
  it('describes each mode distinctly', () => {
    expect(REPLAY_MODES).toEqual(['retry', 'replay', 'rebuild', 'regenerate']);
    expect(describeReplay('retry')).toMatchObject({
      scope: 'incomplete',
      reusesManifest: true,
      reusesFrozenVersions: true,
    });
    expect(describeReplay('replay')).toMatchObject({
      scope: 'all',
      reusesManifest: true,
      verifyByteIdentical: false,
    });
    expect(describeReplay('rebuild')).toMatchObject({ scope: 'all', verifyByteIdentical: true });
    expect(describeReplay('regenerate')).toMatchObject({
      reusesManifest: false,
      reusesFrozenVersions: false,
    });
  });

  it('retry seeds a new run that reuses succeeded outputs and re-runs only the rest', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const prior = failedRun(coord);
    expect(prior.status).toBe('failed');

    const seed = unwrap(coord.seedReplay(prior, runId('run-2'), 'retry'));
    expect(seed.nodes['a']?.state).toBe('succeeded'); // preserved
    expect(seed.nodes['a']?.outputs).toEqual({ out: 'sha256:a' });
    expect(seed.nodes['b']?.state).toBe('pending'); // reset
    expect(seed.nodes['d']?.state).toBe('pending');

    const finished = driveToCompletion(coord, at(0), seed);
    expect(finished.state.status).toBe('succeeded');
    // A was never re-dispatched — its recorded output is unchanged.
    expect(finished.state.nodes['a']?.outputs).toEqual({ out: 'sha256:a' });
    expect(finished.state.nodes['a']?.attempts).toBe(1);
  });

  it('replay/rebuild seed a clean run; regenerate is a documented seam', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const prior = failedRun(coord);
    const replaySeed = unwrap(coord.seedReplay(prior, runId('run-3'), 'replay'));
    expect(Object.values(replaySeed.nodes).every((n) => n.state === 'pending')).toBe(true);
    expect(unwrapErr(coord.seedReplay(prior, runId('run-4'), 'regenerate')).message).toContain(
      'regenerate requires',
    );
  });
});

describe('coordinator validation (untrusted-state gate)', () => {
  it('accepts a consistent state', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const { state } = driveToCompletion(coord, at(0));
    expect(coord.validate(state).ok).toBe(true);
  });

  it('rejects a node marked running whose dependencies have not succeeded', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    const state = initialExecutionState(graph, runId());
    const doctored: ExecutionState = {
      ...state,
      status: 'running',
      nodes: {
        ...state.nodes,
        d: { id: 'd' as never, state: 'running', attempt: 1, attempts: 1, startedAt: at(0) },
      },
    };
    expect(unwrapErr(validateExecutionState(graph, doctored)).message).toContain('dependency');
  });

  it('rejects a state whose pipeline id does not match the graph', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    const state = initialExecutionState(graph, runId());
    const wrong: ExecutionState = { ...state, pipelineId: 'other' as never };
    expect(unwrapErr(validateExecutionState(graph, wrong)).message).toContain('pipeline id');
  });

  it('rejects a succeeded run that has not fully succeeded', () => {
    const graph = buildExecutionGraph(diamondPipeline());
    const state = initialExecutionState(graph, runId());
    const wrong: ExecutionState = { ...state, status: 'succeeded' };
    expect(unwrapErr(validateExecutionState(graph, wrong)).message).toContain('not every node');
  });
});
