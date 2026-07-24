import { describe, it, expect } from 'vitest';
import { WorkerHost } from '@workerv2/worker-host';
import { createReferenceBackend } from '@workerv2/image-backend';
import type { ImageBackend, RasterImage } from '@workerv2/image-backend';
import { seedAlbumBlueprint } from './helpers.js';

/** A decorator backend that counts transform calls — proves the host drives the SELECTED backend. */
function countingBackend(inner: ImageBackend): { backend: ImageBackend; calls: () => number } {
  let calls = 0;
  const count = <T>(fn: () => T): T => {
    calls += 1;
    return fn();
  };
  const backend: ImageBackend = {
    info: { ...inner.info, id: 'counting' },
    decode: (b) => inner.decode(b),
    encode: (i) => inner.encode(i),
    resize: (i, op) => count(() => inner.resize(i, op)),
    rotate: (i, op) => count(() => inner.rotate(i, op)),
    crop: (i, op) => count(() => inner.crop(i, op)),
    convert: (i: RasterImage, op) => count(() => inner.convert(i, op)),
    apply: (i, op) => inner.apply(i, op),
    validate: (i) => inner.validate(i),
  };
  return { backend, calls: () => calls };
}

describe('backend replacement (selection outside processor logic)', () => {
  it('runs with a replaced ImageBackend without changing any processor', async () => {
    const counting = countingBackend(createReferenceBackend());
    const host = new WorkerHost(
      { backendId: 'counting' },
      { backends: [{ id: 'counting', backend: counting.backend }] },
    );
    const result = await host.run(seedAlbumBlueprint(host, 1));

    expect(result.succeeded).toBe(true);
    // The composition adapter drove the SELECTED backend (it was actually invoked).
    expect(counting.calls()).toBeGreaterThan(0);
    // Registered backends are visible + selectable.
    expect(host.backends.ids()).toEqual(['counting', 'reference']);
  });

  it('the deterministic reference backend produces the same album regardless of which host built it', async () => {
    const h1 = new WorkerHost();
    const h2 = new WorkerHost({ backendId: 'reference' });
    const r1 = await h1.run(seedAlbumBlueprint(h1, 2));
    const r2 = await h2.run(seedAlbumBlueprint(h2, 2));
    expect(r1.pdfKey).toBe(r2.pdfKey);
  });

  it('selecting an unregistered backend fails fast at construction', () => {
    expect(() => new WorkerHost({ backendId: 'ghost' })).toThrow(/not registered/);
  });
});
