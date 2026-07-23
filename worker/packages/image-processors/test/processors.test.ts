import { describe, it, expect } from 'vitest';
import { ProcessorHarness } from '@workerv2/processor-sdk';
import {
  imageValidationSpec,
  imageDecodeSpec,
  imageMetadataSpec,
  imageExifOrientationSpec,
  imageColorNormalizeSpec,
  imageFormatNormalizeSpec,
  SLOT,
} from '@workerv2/image-processors';
import type { DecodedImage, ImageMetadata } from '@workerv2/image-processors';
import { buildPng, buildJpeg, buildGif } from './fixtures.js';

describe('image.validate', () => {
  it('accepts a valid image and produces a report', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(buildPng({ width: 100, height: 80, colorType: 2 }));
    const r = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.report],
    });
    expect(r.outcome.ok).toBe(true);
    expect(JSON.parse(r.outputText(SLOT.report))).toMatchObject({
      ok: true,
      format: 'png',
      width: 100,
      height: 80,
      pixels: 8000,
    });
  });

  it('rejects an unrecognized format permanently', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]));
    const r = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.report],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });

  it('rejects a decompression bomb via the pixel guard', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(buildPng({ width: 20000, height: 20000 })); // 400 MP
    const r = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.report],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.message).toMatch(/decompression-bomb/);
  });

  it('honours a configured allow-list and byte cap', async () => {
    const h = new ProcessorHarness();
    const gif = h.seed(buildGif(10, 10));
    const disallowed = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: gif },
      config: { allowedFormats: ['png', 'jpeg'] },
      expectedOutputs: [SLOT.report],
    });
    expect(disallowed.outcome.ok).toBe(false);

    const png = h.seed(buildPng({ width: 10, height: 10 }));
    const tooBig = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: png },
      config: { maxBytes: 4 },
      expectedOutputs: [SLOT.report],
    });
    expect(tooBig.outcome.ok).toBe(false);
  });

  it('fails permanently on an invalid config', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(buildPng({ width: 10, height: 10 }));
    const r = await h.execute(imageValidationSpec, {
      inputs: { [SLOT.image]: image },
      config: { maxPixels: -5 },
      expectedOutputs: [SLOT.report],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });
});

describe('image.decode', () => {
  it('produces a structural DecodedImage descriptor', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(buildJpeg({ width: 200, height: 120, components: 3 }));
    const r = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.decoded],
    });
    expect(r.outcome.ok).toBe(true);
    const decoded = JSON.parse(r.outputText(SLOT.decoded)) as DecodedImage;
    expect(decoded).toMatchObject({
      schema: 'workerv2.image.decoded/1',
      format: 'jpeg',
      width: 200,
      height: 120,
      colorType: 'ycbcr',
    });
  });

  it('fails permanently on undecodable bytes', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(new Uint8Array([1, 2, 3, 4]));
    const r = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.decoded],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });

  it('fails permanently when the required input slot is missing', async () => {
    const h = new ProcessorHarness();
    const r = await h.execute(imageDecodeSpec, { expectedOutputs: [SLOT.decoded] });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });
});

describe('image.metadata', () => {
  it('records format, dimensions, and EXIF through the artifact', async () => {
    const h = new ProcessorHarness();
    const image = h.seed(
      buildJpeg({ width: 30, height: 20, exif: { orientation: 6, model: 'EOS' } }),
    );
    const r = await h.execute(imageMetadataSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.metadata],
    });
    expect(r.outcome.ok).toBe(true);
    const meta = JSON.parse(r.outputText(SLOT.metadata)) as ImageMetadata;
    expect(meta).toMatchObject({
      format: 'jpeg',
      dimensions: { width: 30, height: 20 },
      hasExif: true,
      exif: { orientation: 6, model: 'EOS' },
    });
  });
});

describe('image.exif-orientation (chained on decode + metadata)', () => {
  async function decodeAndMeta(h: ProcessorHarness, bytes: Uint8Array) {
    const image = h.seed(bytes);
    const decoded = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.decoded],
    });
    const metadata = await h.execute(imageMetadataSpec, {
      inputs: { [SLOT.image]: image },
      expectedOutputs: [SLOT.metadata],
    });
    return {
      decoded: decoded.outputs![SLOT.decoded]!,
      metadata: metadata.outputs![SLOT.metadata]!,
    };
  }

  it('swaps dimensions for orientation 6 and normalizes to 1', async () => {
    const h = new ProcessorHarness();
    const inputs = await decodeAndMeta(
      h,
      buildJpeg({ width: 300, height: 200, exif: { orientation: 6 } }),
    );
    const r = await h.execute(imageExifOrientationSpec, {
      inputs,
      expectedOutputs: [SLOT.oriented],
    });
    expect(r.outcome.ok).toBe(true);
    expect(JSON.parse(r.outputText(SLOT.oriented))).toMatchObject({
      sourceOrientation: 6,
      width: 200,
      height: 300,
      swapsDimensions: true,
      normalizedOrientation: 1,
    });
  });

  it('defaults to orientation 1 when EXIF is absent', async () => {
    const h = new ProcessorHarness();
    const inputs = await decodeAndMeta(h, buildPng({ width: 40, height: 60 }));
    // A PNG has no EXIF, so metadata.exif.orientation is undefined → treated as 1.
    const decoded = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: h.seed(buildPng({ width: 40, height: 60 })) },
      expectedOutputs: [SLOT.decoded],
    });
    const r = await h.execute(imageExifOrientationSpec, {
      inputs: { [SLOT.decoded]: decoded.outputs![SLOT.decoded]!, [SLOT.metadata]: inputs.metadata },
      expectedOutputs: [SLOT.oriented],
    });
    expect(r.outcome.ok).toBe(true);
    expect(JSON.parse(r.outputText(SLOT.oriented))).toMatchObject({
      sourceOrientation: 1,
      width: 40,
      height: 60,
      swapsDimensions: false,
    });
  });

  it('rejects a wrong-schema descriptor input permanently', async () => {
    const h = new ProcessorHarness();
    const notDecoded = h.seedJson({ schema: 'nope', width: 1, height: 1 });
    const meta = h.seedJson({ schema: 'workerv2.image.metadata/1', exif: {} });
    const r = await h.execute(imageExifOrientationSpec, {
      inputs: { [SLOT.decoded]: notDecoded, [SLOT.metadata]: meta },
      expectedOutputs: [SLOT.oriented],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });
});

describe('image.color-normalize', () => {
  async function decode(h: ProcessorHarness, bytes: Uint8Array) {
    const r = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: h.seed(bytes) },
      expectedOutputs: [SLOT.decoded],
    });
    return r.outputs![SLOT.decoded]!;
  }

  it('targets sRGB with a 4-channel layout for an alpha source', async () => {
    const h = new ProcessorHarness();
    const decoded = await decode(h, buildPng({ width: 10, height: 10, colorType: 6 }));
    const r = await h.execute(imageColorNormalizeSpec, {
      inputs: { [SLOT.decoded]: decoded },
      expectedOutputs: [SLOT.color],
    });
    // 8-bit RGBA without an ICC profile is already sRGB-shaped → no conversion.
    expect(JSON.parse(r.outputText(SLOT.color))).toMatchObject({
      targetColorSpace: 'srgb',
      targetChannels: 4,
      requiresConversion: false,
    });
  });

  it('requires conversion for a non-RGB colour type (grayscale)', async () => {
    const h = new ProcessorHarness();
    const decoded = await decode(h, buildPng({ width: 10, height: 10, colorType: 0 }));
    const r = await h.execute(imageColorNormalizeSpec, {
      inputs: { [SLOT.decoded]: decoded },
      expectedOutputs: [SLOT.color],
    });
    expect(JSON.parse(r.outputText(SLOT.color))).toMatchObject({
      targetChannels: 3,
      requiresConversion: true,
    });
  });

  it('requires conversion when an ICC profile is embedded', async () => {
    const h = new ProcessorHarness();
    const decoded = await decode(h, buildPng({ width: 10, height: 10, colorType: 2, icc: 'sRGB' }));
    const r = await h.execute(imageColorNormalizeSpec, {
      inputs: { [SLOT.decoded]: decoded },
      expectedOutputs: [SLOT.color],
    });
    expect(JSON.parse(r.outputText(SLOT.color)).requiresConversion).toBe(true);
  });
});

describe('image.format-normalize', () => {
  async function decode(h: ProcessorHarness, bytes: Uint8Array) {
    const r = await h.execute(imageDecodeSpec, {
      inputs: { [SLOT.image]: h.seed(bytes) },
      expectedOutputs: [SLOT.decoded],
    });
    return r.outputs![SLOT.decoded]!;
  }

  it('normalizes alpha sources to PNG and others to JPEG', async () => {
    const h = new ProcessorHarness();
    const rgba = await decode(h, buildPng({ width: 4, height: 4, colorType: 6 }));
    const rgbaOut = await h.execute(imageFormatNormalizeSpec, {
      inputs: { [SLOT.decoded]: rgba },
      expectedOutputs: [SLOT.format],
    });
    expect(JSON.parse(rgbaOut.outputText(SLOT.format))).toMatchObject({
      targetFormat: 'png',
      requiresTranscode: false,
      contentType: 'image/png',
    });

    const gif = await decode(h, buildGif(4, 4));
    const gifOut = await h.execute(imageFormatNormalizeSpec, {
      inputs: { [SLOT.decoded]: gif },
      expectedOutputs: [SLOT.format],
    });
    expect(JSON.parse(gifOut.outputText(SLOT.format))).toMatchObject({
      sourceFormat: 'gif',
      targetFormat: 'jpeg',
      requiresTranscode: true,
    });
  });

  it('honours a forced target from config', async () => {
    const h = new ProcessorHarness();
    const rgba = await decode(h, buildPng({ width: 4, height: 4, colorType: 6 }));
    const r = await h.execute(imageFormatNormalizeSpec, {
      inputs: { [SLOT.decoded]: rgba },
      config: { forceTarget: 'jpeg' },
      expectedOutputs: [SLOT.format],
    });
    expect(JSON.parse(r.outputText(SLOT.format)).targetFormat).toBe('jpeg');
  });

  it('rejects an invalid forceTarget permanently', async () => {
    const h = new ProcessorHarness();
    const decoded = await decode(h, buildPng({ width: 4, height: 4 }));
    const r = await h.execute(imageFormatNormalizeSpec, {
      inputs: { [SLOT.decoded]: decoded },
      config: { forceTarget: 'webp' },
      expectedOutputs: [SLOT.format],
    });
    expect(r.outcome.ok).toBe(false);
    if (!r.outcome.ok) expect(r.outcome.error.kind).toBe('permanent');
  });
});
