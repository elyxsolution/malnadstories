import { describe, it, expect } from 'vitest';
import { createReferenceBackend, solidRaster, makeRaster } from '@workerv2/image-backend';
import type { RasterImage } from '@workerv2/image-backend';
import { rasterizeStack } from '@workerv2/composition';
import type { Layer, LayerStack, Rgba } from '@workerv2/composition';

const backend = createReferenceBackend();
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];

function px(raster: RasterImage, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [
    raster.data[i] as number,
    raster.data[i + 1] as number,
    raster.data[i + 2] as number,
    raster.data[i + 3] as number,
  ];
}

function layer(raster: RasterImage, dest: Layer['dest'], overrides: Partial<Layer> = {}): Layer {
  return { raster, dest, z: 0, opacity: 1, blend: 'normal', fit: 'fill', ...overrides };
}

function stack(
  width: number,
  height: number,
  layers: Layer[],
  background: Rgba = BLACK,
): LayerStack {
  return { width, height, background, layers };
}

describe('rasterizeStack — background + placement', () => {
  it('fills the background when there are no layers', () => {
    const out = rasterizeStack(backend, stack(2, 2, [], { r: 10, g: 20, b: 30, a: 255 }));
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(out).toMatchObject({ width: 2, height: 2, channels: 4 });
  });

  it('composites a fill placement into its destination only', () => {
    const out = rasterizeStack(
      backend,
      stack(4, 4, [layer(solidRaster(2, 2, RED), { x: 1, y: 1, width: 2, height: 2 })]),
    );
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 255]); // background
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]); // placement
    expect(px(out, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(px(out, 3, 3)).toEqual([0, 0, 0, 255]); // outside placement
  });
});

describe('z-ordering', () => {
  it('draws higher z on top regardless of input order', () => {
    const dest = { x: 0, y: 0, width: 2, height: 2 };
    const out = rasterizeStack(
      backend,
      stack(2, 2, [
        layer(solidRaster(2, 2, GREEN), dest, { z: 5 }),
        layer(solidRaster(2, 2, RED), dest, { z: 1 }),
      ]),
    );
    // GREEN has the higher z → it wins.
    expect(px(out, 0, 0)).toEqual([0, 255, 0, 255]);
  });
});

describe('opacity + blend modes', () => {
  it('applies layer opacity', () => {
    const out = rasterizeStack(
      backend,
      stack(1, 1, [
        layer(
          solidRaster(1, 1, [200, 200, 200]),
          { x: 0, y: 0, width: 1, height: 1 },
          { opacity: 0.5 },
        ),
      ]),
    );
    expect(px(out, 0, 0).slice(0, 3)).toEqual([100, 100, 100]);
  });

  it('multiply darkens against the background', () => {
    const out = rasterizeStack(
      backend,
      stack(
        1,
        1,
        [
          layer(
            solidRaster(1, 1, [200, 200, 200]),
            { x: 0, y: 0, width: 1, height: 1 },
            { blend: 'multiply' },
          ),
        ],
        {
          r: 100,
          g: 100,
          b: 100,
          a: 255,
        },
      ),
    );
    expect(px(out, 0, 0)[0]).toBe(78);
  });
});

describe('clipping', () => {
  it('restricts drawing to the clip rectangle', () => {
    const out = rasterizeStack(
      backend,
      stack(2, 2, [
        layer(
          solidRaster(2, 2, RED),
          { x: 0, y: 0, width: 2, height: 2 },
          {
            clip: { x: 0, y: 0, width: 1, height: 2 },
          },
        ),
      ]),
    );
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]); // inside clip
    expect(px(out, 1, 0)).toEqual([0, 0, 0, 255]); // clipped away → background
  });
});

describe('masks', () => {
  it('uses a grayscale mask as per-pixel alpha', () => {
    // Left column opaque (255), right column transparent (0).
    const mask = makeRaster(2, 1, [255, 0], 'gray', 1);
    const out = rasterizeStack(
      backend,
      stack(2, 1, [layer(solidRaster(2, 1, RED), { x: 0, y: 0, width: 2, height: 1 }, { mask })]),
    );
    expect(px(out, 0, 0)).toEqual([255, 0, 0, 255]); // masked in
    expect(px(out, 1, 0)).toEqual([0, 0, 0, 255]); // masked out → background
  });
});

describe('frames', () => {
  it('draws a border around the destination', () => {
    const out = rasterizeStack(
      backend,
      stack(4, 4, [
        layer(
          solidRaster(4, 4, RED),
          { x: 0, y: 0, width: 4, height: 4 },
          {
            frame: { thickness: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
          },
        ),
      ]),
    );
    expect(px(out, 0, 0)).toEqual([0, 0, 255, 255]); // border (corner)
    expect(px(out, 0, 1)).toEqual([0, 0, 255, 255]); // border (left edge)
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]); // interior = image
  });
});

describe('transform (orthogonal rotate)', () => {
  it('rotates a layer before fitting it', () => {
    // A 2x1 image: left red, right green. Rotated 90° CW becomes 1x2 (top red, bottom green),
    // then fit 'fill' into a 1x2 dest.
    const img = makeRaster(2, 1, [255, 0, 0, 0, 255, 0], 'srgb', 3);
    const out = rasterizeStack(
      backend,
      stack(1, 2, [layer(img, { x: 0, y: 0, width: 1, height: 2 }, { rotate: 90 })]),
    );
    expect(px(out, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(out, 0, 1).slice(0, 3)).toEqual([0, 255, 0]);
  });
});
