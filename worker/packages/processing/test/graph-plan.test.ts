import { describe, expect, it } from 'vitest';
import { orderStepGraph, compileExecutionPlan } from '@workerv2/processing';
import { diamondSteps, makePipeline, step, unwrap } from './helpers.js';

describe('orderStepGraph — DAG validation + deterministic stages', () => {
  it('orders the diamond into stage-monotonic, lexicographic order', () => {
    const result = unwrap(
      orderStepGraph([
        { id: 'merge', dependsOn: ['left', 'right'] },
        { id: 'right', dependsOn: ['ingest'] },
        { id: 'ingest', dependsOn: [] },
        { id: 'left', dependsOn: ['ingest'] },
      ]),
    );
    expect(result.stages).toStrictEqual([['ingest'], ['left', 'right'], ['merge']]);
    expect(result.order).toStrictEqual(['ingest', 'left', 'right', 'merge']);
  });

  it('is invariant under declaration order (determinism)', () => {
    const nodes = [
      { id: 'b', dependsOn: [] },
      { id: 'a', dependsOn: [] },
      { id: 'c', dependsOn: ['a', 'b'] },
    ];
    const forward = unwrap(orderStepGraph(nodes));
    const reversed = unwrap(orderStepGraph([...nodes].reverse()));
    expect(forward).toStrictEqual(reversed);
    expect(forward.order).toStrictEqual(['a', 'b', 'c']);
  });

  it('stages group by longest dependency chain, not by earliest availability', () => {
    // z is independent (stage 0) even though it sorts last; y needs x (stage 1).
    const result = unwrap(
      orderStepGraph([
        { id: 'x', dependsOn: [] },
        { id: 'y', dependsOn: ['x'] },
        { id: 'z', dependsOn: [] },
      ]),
    );
    expect(result.stages).toStrictEqual([['x', 'z'], ['y']]);
  });

  it('rejects unknown deps, self-deps, and cycles', () => {
    expect(orderStepGraph([{ id: 'a', dependsOn: ['nope'] }]).ok).toBe(false);
    expect(orderStepGraph([{ id: 'a', dependsOn: ['a'] }]).ok).toBe(false);
    expect(
      orderStepGraph([
        { id: 'a', dependsOn: ['c'] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['b'] },
      ]).ok,
    ).toBe(false);
  });
});

describe('compileExecutionPlan — deterministic, immutable, engine-neutral', () => {
  it('compiles the diamond pipeline into ordered stages', () => {
    const plan = compileExecutionPlan(makePipeline(diamondSteps()));
    expect(plan.pipelineId).toBe('pl-1');
    expect(plan.pipelineVersion).toBe('1.0.0');
    expect(plan.order).toStrictEqual(['ingest', 'left', 'right', 'merge']);
    expect(plan.stages).toStrictEqual([['ingest'], ['left', 'right'], ['merge']]);
    expect(plan.steps.map((p) => [p.step.id, p.stage])).toStrictEqual([
      ['ingest', 0],
      ['left', 1],
      ['right', 1],
      ['merge', 2],
    ]);
  });

  it('is invariant under step declaration order (plan determinism)', () => {
    const scrambled = diamondSteps();
    const sorted = [...scrambled].sort((a, b) => a.id.localeCompare(b.id));
    const planA = compileExecutionPlan(makePipeline(scrambled));
    const planB = compileExecutionPlan(makePipeline(sorted));
    expect(planA).toStrictEqual(planB);
  });

  it('repeat compilation of the same pipeline is structurally identical', () => {
    const pipeline = makePipeline(diamondSteps());
    expect(compileExecutionPlan(pipeline)).toStrictEqual(compileExecutionPlan(pipeline));
  });

  it('deep-freezes the plan (immutability)', () => {
    const plan = compileExecutionPlan(makePipeline(diamondSteps()));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.order)).toBe(true);
    expect(Object.isFrozen(plan.stages)).toBe(true);
    expect(Object.isFrozen(plan.stages[0])).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
    expect(Object.isFrozen(plan.steps[0])).toBe(true);
  });

  it('a single-step pipeline compiles to one stage', () => {
    const plan = compileExecutionPlan(makePipeline([step('only', { outputs: ['out'] })]));
    expect(plan.stages).toStrictEqual([['only']]);
    expect(plan.steps[0]?.stage).toBe(0);
  });
});
