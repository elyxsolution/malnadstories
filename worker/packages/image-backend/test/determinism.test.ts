import { describe, it, expect } from 'vitest';
import {
  createReferenceBackend,
  PixelGateway,
  InMemoryArtifactBytesStore,
  encodeRaster,
  gradientRaster,
} from '@workerv2/image-backend';
import type { ImageOperation } from '@workerv2/image-backend';
import { runImageBackendContract } from './contract/image-backend-contract.js';

// The reference backend must satisfy the shared backend contract.
runImageBackendContract('ReferenceImageBackend', () => createReferenceBackend());

describe('determinism — output depends ONLY on input pixels + operations', () => {
  const pipeline: ImageOperation[] = [
    { op: 'crop', x: 1, y: 1, width: 10, height: 10 },
    { op: 'rotate', degrees: 90 },
    { op: 'resize', width: 5, height: 7, filter: 'bilinear' },
    { op: 'convert', colorSpace: 'linear' },
    { op: 'convert', colorSpace: 'srgb' },
    { op: 'convert', channels: 4 },
  ];

  it('two independent backends produce byte-identical results', () => {
    const src = gradientRaster(16, 16);
    const run = (): Uint8Array => {
      const backend = createReferenceBackend();
      let img = src;
      for (const op of pipeline) img = backend.apply(img, op);
      return backend.encode(img);
    };
    expect(Array.from(run())).toEqual(Array.from(run()));
  });

  it('the gateway yields the same content address across independent stores', async () => {
    const bytes = encodeRaster(gradientRaster(16, 16));
    const produceOnce = async (): Promise<string> => {
      const store = new InMemoryArtifactBytesStore();
      const gateway = new PixelGateway(createReferenceBackend(), store);
      const key = store.seed(bytes);
      const result = await gateway.transform(key, pipeline);
      return result.key;
    };
    expect(await produceOnce()).toBe(await produceOnce());
  });

  it('different operations produce different outputs', () => {
    const backend = createReferenceBackend();
    const src = gradientRaster(8, 8);
    const a = backend.encode(backend.resize(src, { op: 'resize', width: 4, height: 4 }));
    const b = backend.encode(backend.resize(src, { op: 'resize', width: 5, height: 4 }));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
