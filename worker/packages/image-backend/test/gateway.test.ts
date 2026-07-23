import { describe, it, expect } from 'vitest';
import {
  PixelGateway,
  createReferenceBackend,
  InMemoryArtifactBytesStore,
  encodeRaster,
  decodeRaster,
  gradientRaster,
  solidRaster,
  RASTER_DESCRIPTOR_SCHEMA,
  BackendError,
} from '@workerv2/image-backend';
import type { RasterImage } from '@workerv2/image-backend';

function setup(): { gateway: PixelGateway; store: InMemoryArtifactBytesStore } {
  const store = new InMemoryArtifactBytesStore();
  const gateway = new PixelGateway(createReferenceBackend(), store);
  return { gateway, store };
}

describe('PixelGateway', () => {
  it('decodes an artifact, transforms it, and produces a raster artifact', async () => {
    const { gateway, store } = setup();
    const sourceKey = store.seed(encodeRaster(gradientRaster(8, 6)));
    const result = await gateway.transform(sourceKey, [
      { op: 'crop', x: 1, y: 1, width: 4, height: 4 },
      { op: 'resize', width: 2, height: 2, filter: 'nearest' },
      { op: 'convert', channels: 4 },
    ]);
    expect(result.image).toMatchObject({ width: 2, height: 2, channels: 4 });
    expect(result.descriptor).toMatchObject({
      schema: RASTER_DESCRIPTOR_SCHEMA,
      width: 2,
      height: 2,
      channels: 4,
      backend: { id: 'reference', deterministic: true },
    });
    // The produced artifact decodes back to the same raster.
    const bytes = await store.read(result.key);
    expect(decodeRaster(bytes)).toStrictEqual(result.image);
  });

  it('produces a content-addressed artifact (identical output → same key)', async () => {
    const { gateway } = setup();
    const image = solidRaster(3, 3, [9, 9, 9]);
    const first = await gateway.produce(image);
    const second = await gateway.produce(image);
    expect(first.key).toBe(second.key);
  });

  it('refuses to produce an invalid raster (output gate)', async () => {
    const { gateway } = setup();
    const bad: RasterImage = { ...solidRaster(2, 2, [1, 2, 3]), data: new Uint8Array(3) };
    await expect(gateway.produce(bad)).rejects.toThrow();
  });

  it('rejects an invalid operation before touching the store', async () => {
    const { gateway, store } = setup();
    const key = store.seed(encodeRaster(solidRaster(2, 2, [1, 2, 3])));
    await expect(gateway.transform(key, [{ op: 'resize', width: 0, height: 2 }])).rejects.toThrow(
      BackendError,
    );
    expect(store.count).toBe(1); // nothing new produced
  });

  it('applyOperations is pure and deterministic (no I/O)', () => {
    const { gateway } = setup();
    const src = gradientRaster(6, 6);
    const ops = [
      { op: 'rotate', degrees: 90 },
      { op: 'convert', colorSpace: 'gray' },
    ] as const;
    const a = gateway.applyOperations(src, [...ops]);
    const b = gateway.applyOperations(src, [...ops]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a).toMatchObject({ width: 6, height: 6, channels: 1, colorSpace: 'gray' });
  });
});
