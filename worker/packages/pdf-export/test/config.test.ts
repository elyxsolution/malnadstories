import { describe, it, expect } from 'vitest';
import {
  parsePdfExportConfig,
  DEFAULT_PDF_CONFIG,
  canonicalExportConfig,
} from '@workerv2/pdf-export';

describe('parsePdfExportConfig', () => {
  it('applies defaults for an empty config', () => {
    const result = parsePdfExportConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(DEFAULT_PDF_CONFIG);
  });

  it('accepts a fully-specified config', () => {
    const result = parsePdfExportConfig({
      pdfVersion: '1.4',
      pageSize: { width: 595, height: 842 },
      bleed: 9,
      cropMarks: true,
      compression: 'flate',
      metadata: { title: 'T', author: 'A' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        pdfVersion: '1.4',
        pageSize: { width: 595, height: 842 },
        bleed: 9,
        cropMarks: true,
        compression: 'flate',
        metadata: { title: 'T', author: 'A' },
      });
    }
  });

  it('rejects unsupported values', () => {
    expect(parsePdfExportConfig({ pdfVersion: '2.0' }).ok).toBe(false);
    expect(parsePdfExportConfig({ compression: 'zip' }).ok).toBe(false);
    expect(parsePdfExportConfig({ bleed: -1 }).ok).toBe(false);
    expect(parsePdfExportConfig({ cropMarks: 'yes' }).ok).toBe(false);
    expect(parsePdfExportConfig({ pageSize: { width: 0, height: 10 } }).ok).toBe(false);
    expect(parsePdfExportConfig({ metadata: { title: 42 } }).ok).toBe(false);
  });

  it('canonical config is a deterministic string basis for identity', () => {
    const a = parsePdfExportConfig({ bleed: 5, pdfVersion: '1.7' });
    const b = parsePdfExportConfig({ pdfVersion: '1.7', bleed: 5 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(canonicalExportConfig(a.value)).toBe(canonicalExportConfig(b.value));
  });
});
