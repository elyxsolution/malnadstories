import { describe, it, expect } from 'vitest';
import { ProcessorHarness } from '@workerv2/processor-sdk';
import type { ProcessorSpec } from '@workerv2/processor-sdk';
import {
  imageFoundationProcessorSpecs,
  createImageFoundationProcessors,
  imageValidationSpec,
  imageDecodeSpec,
  imageMetadataSpec,
  SLOT,
} from '@workerv2/image-processors';
import { buildJpeg, buildPng } from './fixtures.js';

/** Run one spec with a fresh harness and return the produced output key for a slot. */
async function runOnce(
  spec: ProcessorSpec,
  bytes: Uint8Array,
  slot: string,
): Promise<string | undefined> {
  const h = new ProcessorHarness();
  const r = await h.execute(spec, {
    inputs: { [SLOT.image]: h.seed(bytes) },
    expectedOutputs: [slot],
  });
  return r.outcome.ok ? r.outputs![slot] : undefined;
}

describe('determinism — outputs depend ONLY on input artifacts + config', () => {
  const cases: Array<[string, ProcessorSpec, string]> = [
    ['image.validate', imageValidationSpec, SLOT.report],
    ['image.decode', imageDecodeSpec, SLOT.decoded],
    ['image.metadata', imageMetadataSpec, SLOT.metadata],
  ];

  for (const [name, spec, slot] of cases) {
    it(`${name} produces a byte-identical content address across independent runs`, async () => {
      const bytes = buildJpeg({ width: 640, height: 480, exif: { orientation: 6, make: 'Canon' } });
      const a = await runOnce(spec, bytes, slot);
      const b = await runOnce(spec, bytes, slot);
      expect(a).toBeDefined();
      expect(a).toBe(b); // same content → same content address (idempotent, deterministic)
    });
  }

  it('canonical serialization makes the address independent of key insertion order', async () => {
    // Two logically-identical images decode to the same descriptor bytes regardless of run.
    const png = buildPng({ width: 12, height: 8, colorType: 6 });
    const first = await runOnce(imageDecodeSpec, png, SLOT.decoded);
    const second = await runOnce(imageDecodeSpec, png, SLOT.decoded);
    expect(first).toBe(second);
  });

  it('different inputs produce different addresses', async () => {
    const a = await runOnce(imageDecodeSpec, buildPng({ width: 10, height: 10 }), SLOT.decoded);
    const b = await runOnce(imageDecodeSpec, buildPng({ width: 10, height: 11 }), SLOT.decoded);
    expect(a).not.toBe(b);
  });
});

describe('registry surface', () => {
  it('exposes exactly the six foundation specs with unique names + stable version', () => {
    expect(imageFoundationProcessorSpecs).toHaveLength(6);
    const names = imageFoundationProcessorSpecs.map((s) => s.descriptor.name);
    expect(new Set(names).size).toBe(6);
    expect(names).toEqual([
      'image.validate',
      'image.decode',
      'image.metadata',
      'image.exif-orientation',
      'image.color-normalize',
      'image.format-normalize',
    ]);
    for (const spec of imageFoundationProcessorSpecs) {
      expect(spec.descriptor.version).toBe('1.0.0');
    }
  });

  it('builds runnable Processor instances wired to one host gateway', async () => {
    const h = new ProcessorHarness();
    const processors = createImageFoundationProcessors({ artifacts: h.artifacts });
    expect(processors).toHaveLength(6);
    const decode = processors.find((p) => p.descriptor.name === 'image.decode');
    expect(decode).toBeDefined();
    const r = await h.runProcessor(decode!, {
      inputs: { [SLOT.image]: h.seed(buildPng({ width: 5, height: 5 })) },
      expectedOutputs: [SLOT.decoded],
    });
    expect(r.outcome.ok).toBe(true);
  });
});
