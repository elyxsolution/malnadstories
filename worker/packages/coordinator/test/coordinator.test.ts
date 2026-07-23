import { describe, expect, it } from 'vitest';
import {
  coordinatorFromManifest,
  createCoordinator,
  progressOf,
  toExecutionEvents,
} from '@workerv2/coordinator';
import {
  at,
  diamondPipeline,
  driveToCompletion,
  key,
  runId,
  sampleManifest,
  unwrap,
  unwrapErr,
  versions,
} from './helpers.js';

describe('end-to-end orchestration', () => {
  it('drives a diamond pipeline to a succeeded run through the full node graph', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const { state } = driveToCompletion(coord, at(0));

    expect(state.status).toBe('succeeded');
    expect(Object.values(state.nodes).map((n) => n.state)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    const progress = progressOf(state);
    expect(progress.fraction).toBe(1);
    expect(progress.nodesSettled).toBe(true);
    expect(progress.settled).toBe(true);
    expect(progress.succeeded).toBe(4);
  });

  it('consumes a Manifest (via the pipeline bridge) and runs it to completion', () => {
    const coord = unwrap(coordinatorFromManifest(sampleManifest(), versions()));
    expect(coord.graph.terminal).toEqual(['assemble:album']);

    const { state, journal } = driveToCompletion(coord, at(0));
    expect(state.status).toBe('succeeded');
    expect(state.nodes['assemble:album']?.state).toBe('succeeded');
    expect(state.nodes['assemble:album']?.outputs).toEqual({
      album: 'sha256:assemble:album-album',
    });
    // The journal opens with the run start and closes with the run succeeding.
    expect(journal[0]?.kind).toBe('run.started');
    expect(journal.at(-1)?.kind).toBe('run.succeeded');
  });

  it('is deterministic: identical inputs produce byte-identical journals', () => {
    const a = driveToCompletion(
      createCoordinator({ pipeline: diamondPipeline(), versions: versions() }),
      at(0),
    );
    const b = driveToCompletion(
      createCoordinator({ pipeline: diamondPipeline(), versions: versions() }),
      at(0),
    );
    const shape = (j: typeof a.journal) =>
      j.map((e) => ({ seq: e.seq, kind: e.kind, node: e.node, to: e.to }));
    expect(shape(a.journal)).toEqual(shape(b.journal));
    expect(a.state).toEqual(b.state);
  });

  it('journal sequence numbers are contiguous from 0', () => {
    const { journal } = driveToCompletion(
      createCoordinator({ pipeline: diamondPipeline(), versions: versions() }),
      at(0),
    );
    expect(journal.map((e) => e.seq)).toEqual(journal.map((_, i) => i));
  });
});

describe('dispatch builds a resolved ProcessingContext', () => {
  it('resolves step-output inputs from recorded upstream outputs, with frozen versions + config', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = coord.initialize(runId());
    state = unwrap(coord.start(state, { at: at(0) })).state;

    // Dispatch + succeed A so its output is recorded.
    const dA = unwrap(coord.dispatch(state, 'a', { at: at(0) }));
    expect(dA.context.inputs).toEqual({ seed: 'sha256:seed' });
    expect(dA.context.versions).toEqual({ manifest: '1.0.0', pdfEngine: '1.0.0' });
    expect(dA.context.attempt).toBe(1);
    expect(dA.context.startedAt).toBe(at(0));
    state = unwrap(
      coord.reportSuccess(dA.state, 'a', { out: key('sha256:a-out') }, { at: at(1) }),
    ).state;

    // B's step-output binding resolves to A's recorded output.
    const dB = unwrap(coord.dispatch(state, 'b', { at: at(2) }));
    expect(dB.context.inputs).toEqual({ in: 'sha256:a-out' });
    expect(dB.context.expectedOutputs).toEqual(['out']);
  });
});

describe('event publication', () => {
  it('derives one execution event per journal entry, prefixed execution.<kind>', () => {
    const { journal } = driveToCompletion(
      createCoordinator({ pipeline: diamondPipeline(), versions: versions() }),
      at(0),
    );
    const events = toExecutionEvents(runId(), journal);
    expect(events).toHaveLength(journal.length);
    expect(events.every((e) => e.type.startsWith('execution.'))).toBe(true);
    expect(events[0]?.type).toBe('execution.run.started');
    expect(events[0]?.runId).toBe('run-1');
  });
});

describe('command preconditions', () => {
  it('rejects dispatching a node that is not ready', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = coord.initialize(runId());
    state = unwrap(coord.start(state, { at: at(0) })).state;
    // 'd' is still pending (its dependencies have not succeeded).
    const error = unwrapErr(coord.dispatch(state, 'd', { at: at(0) }));
    expect(error.message).toContain('not ready');
  });

  it('rejects outputs that do not match the declared output slots', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    let state = coord.initialize(runId());
    state = unwrap(coord.start(state, { at: at(0) })).state;
    state = unwrap(coord.dispatch(state, 'a', { at: at(0) })).state;
    const error = unwrapErr(
      coord.reportSuccess(state, 'a', { wrong: key('sha256:x') }, { at: at(1) }),
    );
    expect(error.message).toContain('outputs are invalid');
  });

  it('rejects starting a run twice', () => {
    const coord = createCoordinator({ pipeline: diamondPipeline(), versions: versions() });
    const started = unwrap(coord.start(coord.initialize(runId()), { at: at(0) }));
    expect(unwrapErr(coord.start(started.state, { at: at(1) })).message).toContain('Cannot start');
  });
});
