import { describe, it, expect } from 'vitest';
import {
  createReferenceBackend,
  InMemoryArtifactBytesStore,
  solidRaster,
  gradientRaster,
} from '@workerv2/image-backend';
import { CompositionEngine, rasterizeStack } from '@workerv2/composition';
import type { LayerStack } from '@workerv2/composition';
import { singleSpreadBlueprint, seedRaster, solid, rect } from './helpers.js';

const backend = createReferenceBackend();

function complexStack(): LayerStack {
  return {
    width: 24,
    height: 20,
    background: { r: 30, g: 30, b: 30, a: 255 },
    layers: [
      {
        raster: gradientRaster(10, 10),
        dest: { x: 1, y: 1, width: 12, height: 10 },
        z: 0,
        opacity: 0.8,
        blend: 'multiply',
        fit: 'cover',
        rotate: 90,
        frame: { thickness: 2, color: { r: 0, g: 0, b: 255, a: 200 } },
      },
      {
        raster: solidRaster(6, 6, [200, 50, 50]),
        dest: { x: 8, y: 6, width: 14, height: 12 },
        z: 1,
        opacity: 0.6,
        blend: 'screen',
        fit: 'contain',
        clip: { x: 10, y: 8, width: 10, height: 8 },
      },
    ],
  };
}

describe('determinism — rendering depends only on the layer stack (pixels + ops)', () => {
  it('rasterizes a complex stack byte-identically across independent runs', () => {
    const a = rasterizeStack(backend, complexStack());
    const b = rasterizeStack(createReferenceBackend(), complexStack());
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('produces the same content address for the same blueprint + artifacts', async () => {
    const compose = async (): Promise<string> => {
      const store = new InMemoryArtifactBytesStore();
      const engine = new CompositionEngine(createReferenceBackend(), store);
      const kA = seedRaster(store, solid(8, 8, [180, 40, 60]));
      const kB = seedRaster(store, solid(8, 8, [40, 180, 60]));
      const bp = singleSpreadBlueprint([
        { slot: 'a', artifact: kA, frame: rect(0, 0, 0.5, 1) },
        { slot: 'b', artifact: kB, frame: rect(0.5, 0, 0.5, 1) },
      ]);
      const surface = bp.nodes.find((n) => n.kind === 'spread')!.id;
      const result = await engine.composeSurface(bp, surface, { width: 12, height: 8 });
      return result.key;
    };
    expect(await compose()).toBe(await compose());
  });

  it('different backgrounds yield different rendered pages', () => {
    const base = complexStack();
    const a = rasterizeStack(backend, base);
    const b = rasterizeStack(backend, { ...base, background: { r: 0, g: 0, b: 0, a: 255 } });
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });
});
