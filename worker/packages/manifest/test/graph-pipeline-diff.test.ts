import { describe, expect, it } from 'vitest';
import { hashBlueprint } from '@workerv2/blueprint';
import { compileExecutionPlan } from '@workerv2/processing';
import {
  consumedArtifacts,
  diffManifests,
  orderManifest,
  producedOutputs,
  terminalNodes,
  toPipeline,
  toPipelineSpec,
  ASSEMBLE_NODE_ID,
} from '@workerv2/manifest';
import { compiled, sampleBlueprint, sampleManifest, unwrap } from './helpers.js';

describe('graph views (processing + dependency graph)', () => {
  it('orders the manifest deterministically: renders in stage 0, assembly in stage 1', () => {
    const order = unwrap(orderManifest(sampleManifest()));
    expect(order.stages).toEqual([
      ['render:cover', 'render:spread:0000', 'render:spread:0001'],
      ['assemble:album'],
    ]);
    expect(order.order).toEqual([
      'render:cover',
      'render:spread:0000',
      'render:spread:0001',
      'assemble:album',
    ]);
  });

  it('consumedArtifacts lists every external content address, deduped + sorted (incl. the blueprint)', () => {
    const manifest = sampleManifest();
    const bpHash = hashBlueprint(sampleBlueprint());
    expect(consumedArtifacts(manifest)).toEqual(
      ['sha256:aa11', 'sha256:bb22', 'sha256:c0ffee', 'sha256:dd44', bpHash].sort(),
    );
  });

  it('producedOutputs and terminalNodes expose the deliverables', () => {
    const manifest = sampleManifest();
    expect(producedOutputs(manifest)).toEqual([
      { node: 'assemble:album', output: 'album' },
      { node: 'render:cover', output: 'page' },
      { node: 'render:spread:0000', output: 'page' },
      { node: 'render:spread:0001', output: 'page' },
    ]);
    expect(terminalNodes(manifest)).toEqual([ASSEMBLE_NODE_ID]);
  });
});

describe('processing bridge (manifest → declarative pipeline)', () => {
  it('bridges losslessly into a validated ProcessingPipeline', () => {
    const result = compiled();
    const pipeline = unwrap(toPipeline(result));
    expect(pipeline.id).toBe(`manifest:${result.hash}`);
    expect(pipeline.version).toBe(result.manifest.schemaVersion);
    expect(pipeline.steps.map((s) => s.id)).toEqual(result.manifest.nodes.map((n) => n.id));
    const assemble = pipeline.steps.find((s) => s.id === ASSEMBLE_NODE_ID);
    expect(assemble?.inputs).toEqual(
      result.manifest.nodes.find((n) => n.id === ASSEMBLE_NODE_ID)?.consumes,
    );
  });

  it('the bridged pipeline compiles into an execution plan with the same stages', () => {
    const result = compiled();
    const plan = compileExecutionPlan(unwrap(toPipeline(result)));
    expect(plan.stages).toEqual(unwrap(orderManifest(result.manifest)).stages);
    expect(plan.order[plan.order.length - 1]).toBe(ASSEMBLE_NODE_ID);
  });

  it('toPipelineSpec is a pure structural mapping', () => {
    const result = compiled();
    const spec = toPipelineSpec(result);
    expect(spec.steps).toHaveLength(result.manifest.nodes.length);
    expect(spec.steps[0]?.config).toEqual(result.manifest.nodes[0]?.config);
  });
});

describe('diff model', () => {
  it('identical manifests diff empty', () => {
    const diff = diffManifests(sampleManifest(), sampleManifest());
    expect(diff).toEqual({ identical: true, added: [], removed: [], changed: [] });
    expect(Object.isFrozen(diff)).toBe(true);
  });

  it('reports added/removed/changed by stable node id — symmetrically', () => {
    const withCover = sampleManifest();
    const noCover = sampleManifest({ cover: undefined });
    const diff = diffManifests(withCover, noCover);
    expect(diff.identical).toBe(false);
    expect(diff.removed).toEqual(['render:cover']);
    expect(diff.added).toEqual([]);
    // Assembly changed: it no longer consumes the cover page.
    expect(diff.changed).toContain('assemble:album');

    const reverse = diffManifests(noCover, withCover);
    expect(reverse.added).toEqual(diff.removed);
    expect(reverse.removed).toEqual(diff.added);
    expect(reverse.changed).toEqual(diff.changed);
  });

  it('an envelope-only change is not identical even with an unchanged node set', () => {
    const a = sampleManifest();
    const b = { ...a, albumId: 'alb-2' };
    const diff = diffManifests(a, b);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.identical).toBe(false);
  });
});
