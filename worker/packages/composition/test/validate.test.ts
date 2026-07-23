import { describe, it, expect } from 'vitest';
import { createReferenceBackend, solidRaster } from '@workerv2/image-backend';
import { validateLayerStack, validateComposedPage } from '@workerv2/composition';
import type { Layer, LayerStack } from '@workerv2/composition';

const backend = createReferenceBackend();

function goodLayer(): Layer {
  return {
    raster: solidRaster(2, 2, [1, 2, 3]),
    dest: { x: 0, y: 0, width: 2, height: 2 },
    z: 0,
    opacity: 1,
    blend: 'normal',
    fit: 'fill',
  };
}

function goodStack(): LayerStack {
  return { width: 4, height: 4, background: { r: 0, g: 0, b: 0, a: 255 }, layers: [goodLayer()] };
}

describe('validateLayerStack', () => {
  it('accepts a well-formed stack', () => {
    expect(validateLayerStack(goodStack()).ok).toBe(true);
  });

  it('rejects a non-positive canvas', () => {
    expect(validateLayerStack({ ...goodStack(), width: 0 }).ok).toBe(false);
  });

  it('rejects an out-of-range opacity', () => {
    const bad = { ...goodStack(), layers: [{ ...goodLayer(), opacity: 2 }] };
    expect(validateLayerStack(bad).ok).toBe(false);
  });

  it('rejects an unknown blend/fit', () => {
    const badBlend = { ...goodStack(), layers: [{ ...goodLayer(), blend: 'burn' as never }] };
    expect(validateLayerStack(badBlend).ok).toBe(false);
    const badFit = { ...goodStack(), layers: [{ ...goodLayer(), fit: 'squish' as never }] };
    expect(validateLayerStack(badFit).ok).toBe(false);
  });

  it('rejects a non-positive destination', () => {
    const bad = {
      ...goodStack(),
      layers: [{ ...goodLayer(), dest: { x: 0, y: 0, width: 0, height: 2 } }],
    };
    expect(validateLayerStack(bad).ok).toBe(false);
  });
});

describe('validateComposedPage', () => {
  const target = { width: 4, height: 4 };

  it('accepts an RGBA page matching the target', () => {
    const page = solidRaster(4, 4, [0, 0, 0, 255]);
    expect(validateComposedPage(backend, page, target).ok).toBe(true);
  });

  it('rejects a page whose dimensions differ from the target', () => {
    const page = solidRaster(3, 4, [0, 0, 0, 255]);
    expect(validateComposedPage(backend, page, target).ok).toBe(false);
  });

  it('rejects a non-RGBA page', () => {
    const page = solidRaster(4, 4, [0, 0, 0]); // 3 channels
    expect(validateComposedPage(backend, page, target).ok).toBe(false);
  });
});
