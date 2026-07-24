import { describe, it, expect } from 'vitest';
import { solidRaster, makeRaster } from '@workerv2/image-backend';
import {
  generatePdf,
  rasterToPdfImage,
  validatePdf,
  DEFAULT_PDF_CONFIG,
  PDF_PRODUCER,
} from '@workerv2/pdf-export';
import type { GeneratorPage, ResolvedPdfConfig } from '@workerv2/pdf-export';

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

function page(raster = solidRaster(4, 4, [255, 0, 0]), widthPt = 4, heightPt = 4): GeneratorPage {
  return { image: rasterToPdfImage(raster), widthPt, heightPt };
}

const config = (over: Partial<ResolvedPdfConfig> = {}): ResolvedPdfConfig => ({
  ...DEFAULT_PDF_CONFIG,
  ...over,
});

describe('rasterToPdfImage — format packing only', () => {
  it('maps channel counts to colour spaces', () => {
    expect(rasterToPdfImage(solidRaster(2, 2, [1])).colorSpace).toBe('DeviceGray');
    expect(rasterToPdfImage(solidRaster(2, 2, [1, 2, 3])).colorSpace).toBe('DeviceRGB');
    const rgba = rasterToPdfImage(makeRaster(1, 1, [10, 20, 30, 200], 'srgb', 4));
    expect(rgba.colorSpace).toBe('DeviceRGB');
    expect(Array.from(rgba.samples)).toEqual([10, 20, 30]);
    expect(Array.from(rgba.smask ?? [])).toEqual([200]);
  });
});

describe('generatePdf — structure', () => {
  it('produces a well-formed PDF with a page per input', () => {
    const bytes = generatePdf([page(), page()], { title: 'Hi' }, config());
    expect(validatePdf(bytes).ok).toBe(true);
    const text = latin1(bytes);
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 2');
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });

  it('embeds the fixed Producer and no creation/mod dates (determinism)', () => {
    const text = latin1(generatePdf([page()], { title: 'X' }, config()));
    // Producer is UTF-16BE hex-encoded; check the hex of the ASCII producer string is present.
    const producerHex =
      'FEFF' +
      [...PDF_PRODUCER]
        .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
        .join('');
    expect(text).toContain(producerHex);
    expect(text).not.toContain('/CreationDate');
    expect(text).not.toContain('/ModDate');
  });

  it('honours the PDF version and bleed/crop-mark config', () => {
    const withBleed = latin1(
      generatePdf([page()], {}, config({ pdfVersion: '1.4', bleed: 10, cropMarks: true })),
    );
    expect(withBleed.startsWith('%PDF-1.4')).toBe(true);
    expect(withBleed).toContain('/TrimBox [10 10 14 14]');
    expect(withBleed).toContain('/MediaBox [0 0 24 24]');
    expect(withBleed).toContain(' S\n'); // crop-mark stroke operators present
  });

  it('flate compression yields a smaller (still valid) PDF and declares the filter', () => {
    const big = generatePdf([page(solidRaster(64, 64, [128, 128, 128]), 64, 64)], {}, config());
    const zipped = generatePdf(
      [page(solidRaster(64, 64, [128, 128, 128]), 64, 64)],
      {},
      config({ compression: 'flate' }),
    );
    expect(validatePdf(zipped).ok).toBe(true);
    expect(latin1(zipped)).toContain('/Filter /FlateDecode');
    expect(zipped.length).toBeLessThan(big.length);
  });
});

describe('determinism', () => {
  it('identical inputs produce byte-identical PDFs', () => {
    const a = generatePdf([page(), page()], { title: 'T', author: 'A' }, config({ bleed: 3 }));
    const b = generatePdf([page(), page()], { title: 'T', author: 'A' }, config({ bleed: 3 }));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('different config produces different bytes (config is part of identity)', () => {
    const a = generatePdf([page()], {}, config());
    const b = generatePdf([page()], {}, config({ bleed: 5 }));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
