import { describe, it, expect } from 'vitest';
import {
  createReferenceBackend,
  InMemoryArtifactBytesStore,
  decodeRaster,
} from '@workerv2/image-backend';
import type { RasterImage } from '@workerv2/image-backend';
import { CompositionEngine, PAGE_DESCRIPTOR_SCHEMA, CompositionError } from '@workerv2/composition';
import { singleSpreadBlueprint, seedRaster, solid, rect, fakeKey } from './helpers.js';

function spreadId(bp: ReturnType<typeof singleSpreadBlueprint>): string {
  return bp.nodes.find((n) => n.kind === 'spread')!.id;
}

function px(raster: RasterImage, x: number, y: number): [number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i] as number, raster.data[i + 1] as number, raster.data[i + 2] as number];
}

describe('CompositionEngine.composeSurface', () => {
  it('composes a blueprint surface into a rendered page Artifact', async () => {
    const store = new InMemoryArtifactBytesStore();
    const engine = new CompositionEngine(createReferenceBackend(), store);

    const kRed = seedRaster(store, solid(4, 4, [255, 0, 0]));
    const kGreen = seedRaster(store, solid(4, 4, [0, 255, 0]));
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: kRed, frame: rect(0, 0, 0.5, 1) },
      { slot: 'b', artifact: kGreen, frame: rect(0.5, 0, 0.5, 1) },
    ]);

    const result = await engine.composeSurface(bp, spreadId(bp), { width: 4, height: 4 });

    expect(result.descriptor).toMatchObject({
      schema: PAGE_DESCRIPTOR_SCHEMA,
      width: 4,
      height: 4,
      channels: 4,
      layerCount: 2,
      backend: 'reference',
    });
    // Left half red, right half green.
    expect(px(result.page, 0, 0)).toEqual([255, 0, 0]);
    expect(px(result.page, 1, 2)).toEqual([255, 0, 0]);
    expect(px(result.page, 2, 0)).toEqual([0, 255, 0]);
    expect(px(result.page, 3, 3)).toEqual([0, 255, 0]);

    // The produced artifact decodes back to the same page raster.
    const bytes = await store.read(result.key);
    expect(decodeRaster(bytes)).toStrictEqual(result.page);
  });

  it('fills the background where no placement covers the page', async () => {
    const store = new InMemoryArtifactBytesStore();
    const engine = new CompositionEngine(createReferenceBackend(), store);
    const k = seedRaster(store, solid(2, 2, [10, 20, 30]));
    const bp = singleSpreadBlueprint([{ slot: 'a', artifact: k, frame: rect(0, 0, 0.5, 0.5) }]);

    const result = await engine.composeSurface(
      bp,
      spreadId(bp),
      { width: 4, height: 4 },
      {
        background: { r: 5, g: 5, b: 5, a: 255 },
      },
    );
    expect(px(result.page, 3, 3)).toEqual([5, 5, 5]); // uncovered → background
  });

  it('rejects a missing surface and a non-positive target', async () => {
    const store = new InMemoryArtifactBytesStore();
    const engine = new CompositionEngine(createReferenceBackend(), store);
    const bp = singleSpreadBlueprint([
      { slot: 'a', artifact: fakeKey('01'), frame: rect(0, 0, 1, 1) },
    ]);
    await expect(engine.composeSurface(bp, 'nope', { width: 4, height: 4 })).rejects.toThrow(
      CompositionError,
    );
    await expect(engine.composeSurface(bp, spreadId(bp), { width: 0, height: 4 })).rejects.toThrow(
      CompositionError,
    );
  });

  it('rasterize() exposes the pure compositor path', () => {
    const engine = new CompositionEngine(
      createReferenceBackend(),
      new InMemoryArtifactBytesStore(),
    );
    const page = engine.rasterize({
      width: 2,
      height: 2,
      background: { r: 1, g: 2, b: 3, a: 255 },
      layers: [],
    });
    expect(px(page, 0, 0)).toEqual([1, 2, 3]);
  });
});
