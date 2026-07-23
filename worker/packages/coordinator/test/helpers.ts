import type { Result } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { ProcessingPipeline, RetryPolicy, TimeoutPolicy } from '@workerv2/processing';
import { definePipeline } from '@workerv2/processing';
import type { RunId, Timestamp, VersionSet } from '@workerv2/control-plane';
import { makeRunId, makeTimestamp, VersionSet as VS } from '@workerv2/control-plane';
import type { BlueprintSource } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';
import type { CompiledManifest } from '@workerv2/manifest';
import { compileManifest } from '@workerv2/manifest';
import type { Coordinator, ExecutionState, JournalEntry } from '@workerv2/coordinator';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function unwrapErr<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error('unwrapErr() called on Ok');
  return r.error;
}

export const key = (s: string): StorageKey => s as unknown as StorageKey;

/** A deterministic injected timestamp `ms` milliseconds after a fixed base. */
export function at(ms: number): Timestamp {
  return unwrap(makeTimestamp(new Date(Date.UTC(2026, 0, 1) + ms)));
}

export function runId(id = 'run-1'): RunId {
  return unwrap(makeRunId(id));
}

export function versions(): VersionSet {
  return unwrap(VS.create({ manifest: '1.0.0', pdfEngine: '1.0.0' }));
}

const rect = (x = 0, y = 0, w = 1, h = 1): { x: number; y: number; w: number; h: number } => ({
  x,
  y,
  w,
  h,
});

/** A small, realistic blueprint source: cover + 2 spreads. */
export function sampleSource(overrides: Partial<BlueprintSource> = {}): BlueprintSource {
  return {
    albumId: 'alb-1',
    title: 'Goa 2026',
    cover: {
      placements: [{ slot: 'hero', artifact: 'sha256:c0ffee', frame: rect() }],
    },
    spreads: [
      { pages: 1, placements: [{ slot: 'main', artifact: 'sha256:aa11', frame: rect() }] },
      { pages: 2, placements: [{ slot: 'pano', artifact: 'sha256:dd44', frame: rect() }] },
    ],
    ...overrides,
  };
}

export function sampleManifest(overrides: Partial<BlueprintSource> = {}): CompiledManifest {
  const blueprint = unwrap(compileBlueprint(sampleSource(overrides))).blueprint;
  return unwrap(compileManifest(blueprint));
}

/**
 * A diamond pipeline A → {B, C} → D with configurable policies on B — useful for testing the
 * scheduler (parallel stage), the retry orchestrator, and the timeout tracker deterministically.
 * A produces `out`; B/C consume A.out and produce `out`; D consumes B.out + C.out, produces `album`.
 */
export function diamondPipeline(
  opts: {
    retryB?: RetryPolicy;
    timeoutB?: TimeoutPolicy;
  } = {},
): ProcessingPipeline {
  return unwrap(
    definePipeline({
      id: 'diamond',
      version: '1.0.0',
      steps: [
        {
          id: 'a',
          processor: 'p',
          outputs: ['out'],
          inputs: { seed: { kind: 'artifact', key: 'sha256:seed' } },
        },
        {
          id: 'b',
          processor: 'p',
          dependsOn: ['a'],
          inputs: { in: { kind: 'step-output', stepId: 'a', output: 'out' } },
          outputs: ['out'],
          ...(opts.retryB === undefined ? {} : { retry: opts.retryB }),
          ...(opts.timeoutB === undefined ? {} : { timeout: opts.timeoutB }),
        },
        {
          id: 'c',
          processor: 'p',
          dependsOn: ['a'],
          inputs: { in: { kind: 'step-output', stepId: 'a', output: 'out' } },
          outputs: ['out'],
        },
        {
          id: 'd',
          processor: 'p',
          dependsOn: ['b', 'c'],
          inputs: {
            b: { kind: 'step-output', stepId: 'b', output: 'out' },
            c: { kind: 'step-output', stepId: 'c', output: 'out' },
          },
          outputs: ['album'],
        },
      ],
    }),
  );
}

/**
 * A synchronous, greedy driver: start the run, then repeatedly dispatch every dispatchable node
 * and immediately report it succeeded (deterministic outputs `sha256:<id>-<slot>`), all at the
 * one injected `now`. Returns the terminal state and the full journal — a stand-in for the
 * simplest infrastructure adapter, used to exercise end-to-end orchestration.
 */
export function driveToCompletion(
  coord: Coordinator,
  now: Timestamp,
  start: ExecutionState = coord.initialize(runId()),
): { state: ExecutionState; journal: JournalEntry[] } {
  const journal: JournalEntry[] = [];
  const started = unwrap(coord.start(start, { at: now }));
  let state = started.state;
  journal.push(...started.entries);

  for (let guard = 0; guard < 1000; guard += 1) {
    const rq = coord.readyQueue(state, now);
    if (rq.dispatchable.length === 0) break;
    for (const id of rq.dispatchable) {
      const dispatched = unwrap(coord.dispatch(state, id, { at: now }));
      state = dispatched.state;
      journal.push(...dispatched.entries);
      const step = coord.graph.nodes[id];
      if (step === undefined) throw new Error(`unknown node ${id}`);
      const outputs = Object.fromEntries(step.outputs.map((o) => [o, key(`sha256:${id}-${o}`)]));
      const done = unwrap(coord.reportSuccess(state, id, outputs, { at: now }));
      state = done.state;
      journal.push(...done.entries);
    }
  }
  return { state, journal };
}
