import { describe, it, expect } from 'vitest';
import type { RasterImage } from '@workerv2/image-backend';
import type { StorageKey } from '@workerv2/infra-contracts';
import {
  findSurface,
  placementsOf,
  rectToPixels,
  surfaceArtifacts,
  surfaceToLayerStack,
  CompositionError,
} from '@workerv2/composition';
import type { SurfaceNode } from '@workerv2/composition';
import { singleSpreadBlueprint, solid, rect, fakeKey } from './helpers.js';

const target = { width: 100, height: 80 };

function spreadOf(blueprint: ReturnType<typeof singleSpreadBlueprint>): SurfaceNode {
  const node = blueprint.nodes.find((n) => n.kind === 'spread');
  return node as SurfaceNode;
}

describe('rectToPixels', () => {
  it('projects a normalized rect onto the pixel canvas', () => {
    expect(rectToPixels(rect(0.5, 0.5, 0.5, 0.5), target)).toEqual({
      x: 50,
      y: 40,
      width: 50,
      height: 40,
    });
  });

  it('never yields a zero-size rectangle', () => {
    expect(rectToPixels(rect(0, 0, 0, 0), target)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('surface lookup', () => {
  it('finds a renderable surface and rejects a non-surface / missing id', () => {
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: fakeKey('01'), frame: rect(0, 0, 1, 1) },
    ]);
    const spread = spreadOf(bp);
    expect(findSurface(bp, spread.id).kind).toBe('spread');
    expect(() => findSurface(bp, 'nope')).toThrow(CompositionError);
    const placementId = spread.children[0] as string;
    expect(() => findSurface(bp, placementId)).toThrow(CompositionError);
  });
});

describe('surfaceToLayerStack', () => {
  it('maps placements to layers (dest from frame, z from order, clip=dest)', () => {
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: fakeKey('0a'), frame: rect(0, 0, 0.5, 1) },
      { slot: 'b', artifact: fakeKey('0b'), frame: rect(0.5, 0, 0.5, 1) },
    ]);
    const spread = spreadOf(bp);
    const resolved = new Map<StorageKey, RasterImage>([
      [fakeKey('0a'), solid(2, 2, [255, 0, 0])],
      [fakeKey('0b'), solid(2, 2, [0, 255, 0])],
    ]);
    const stack = surfaceToLayerStack(bp, spread, target, resolved, { fit: 'fill' });
    expect(stack).toMatchObject({ width: 100, height: 80 });
    expect(stack.layers).toHaveLength(2);
    // Placement order is canonicalized by slot (a before b) → z 0,1.
    expect(stack.layers[0]).toMatchObject({ z: 0, fit: 'fill', dest: { x: 0, width: 50 } });
    expect(stack.layers[1]).toMatchObject({ z: 1, dest: { x: 50, width: 50 } });
    expect(stack.layers[0]?.clip).toEqual(stack.layers[0]?.dest);
  });

  it('throws when an artifact is unresolved', () => {
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: fakeKey('99'), frame: rect(0, 0, 1, 1) },
    ]);
    expect(() => surfaceToLayerStack(bp, spreadOf(bp), target, new Map())).toThrow(
      CompositionError,
    );
  });
});

describe('surfaceArtifacts / placementsOf', () => {
  it('lists distinct referenced artifacts and placements', () => {
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: fakeKey('01'), frame: rect(0, 0, 0.5, 1) },
      { slot: 'b', artifact: fakeKey('02'), frame: rect(0.5, 0, 0.5, 1) },
    ]);
    const spread = spreadOf(bp);
    expect(surfaceArtifacts(bp, spread).sort()).toEqual([fakeKey('01'), fakeKey('02')]);
    expect(placementsOf(bp, spread).map((p) => p.slot)).toEqual(['a', 'b']);
  });
});
