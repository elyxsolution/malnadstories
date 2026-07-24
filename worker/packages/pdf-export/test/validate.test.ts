import { describe, it, expect } from 'vitest';
import { solidRaster } from '@workerv2/image-backend';
import {
  validateExportPages,
  validatePdf,
  generatePdf,
  rasterToPdfImage,
  DEFAULT_PDF_CONFIG,
} from '@workerv2/pdf-export';

describe('validateExportPages', () => {
  it('accepts uniform page sizes', () => {
    const pages = [solidRaster(8, 8, [1, 2, 3]), solidRaster(8, 8, [4, 5, 6])];
    expect(validateExportPages(pages).ok).toBe(true);
  });

  it('rejects an empty page set and inconsistent sizes', () => {
    expect(validateExportPages([]).ok).toBe(false);
    const mixed = [solidRaster(8, 8, [1, 2, 3]), solidRaster(8, 10, [1, 2, 3])];
    const r = validateExportPages(mixed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/inconsistent page sizes/);
  });
});

describe('validatePdf', () => {
  it('accepts a generated PDF', () => {
    const pdf = generatePdf(
      [{ image: rasterToPdfImage(solidRaster(4, 4, [1, 2, 3])), widthPt: 4, heightPt: 4 }],
      {},
      DEFAULT_PDF_CONFIG,
    );
    expect(validatePdf(pdf).ok).toBe(true);
  });

  it('rejects non-PDF / truncated bytes', () => {
    expect(validatePdf(new Uint8Array([1, 2, 3])).ok).toBe(false);
    const enc = new TextEncoder();
    expect(
      validatePdf(enc.encode('not a pdf but long enough to pass the size check .........')).ok,
    ).toBe(false);
  });
});
