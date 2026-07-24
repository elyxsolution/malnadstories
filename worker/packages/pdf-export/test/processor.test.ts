import { describe, it, expect } from 'vitest';
import { encodeRaster, solidRaster } from '@workerv2/image-backend';
import { buildDocument, serializeDocument } from '@workerv2/document';
import {
  pdfExportSpec,
  SLOT,
  validatePdf,
  PDF_DESCRIPTOR_SCHEMA,
  setupPdfExport,
  samplePrintProfile,
} from '@workerv2/pdf-export';
import type { PdfDescriptor } from '@workerv2/pdf-export';

const OUTPUTS = [SLOT.pdf, SLOT.descriptor];

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

describe('PDF export processor — successful export', () => {
  it('exports a Document to a valid PDF Artifact + descriptor', async () => {
    const { harness, documentKey } = setupPdfExport({ pageCount: 3 });
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: documentKey },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    expect(result.outcome.ok).toBe(true);

    const pdf = result.outputBytes(SLOT.pdf);
    expect(validatePdf(pdf).ok).toBe(true);
    expect(latin1(pdf)).toContain('/Count 3');

    const descriptor = JSON.parse(result.outputText(SLOT.descriptor)) as PdfDescriptor;
    expect(descriptor).toMatchObject({
      schema: PDF_DESCRIPTOR_SCHEMA,
      document: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      pdfVersion: '1.7',
      processor: '1.0.0',
    });
    expect(descriptor.pages).toHaveLength(3);
  });

  it('embeds the Document title as PDF metadata by default, config overrides it', async () => {
    const { harness, documentKey } = setupPdfExport();
    const withDefault = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: documentKey },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    const titleHex = (s: string): string =>
      'FEFF' +
      [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('');
    expect(latin1(withDefault.outputBytes(SLOT.pdf))).toContain(titleHex('Harness Album'));

    const overridden = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: documentKey },
      config: { metadata: { title: 'Custom' } },
      expectedOutputs: OUTPUTS,
    });
    expect(latin1(overridden.outputBytes(SLOT.pdf))).toContain(titleHex('Custom'));
  });

  it('preserves page ordering — the descriptor records the documents ordered page identities', async () => {
    const { harness, documentKey, pageKeys } = setupPdfExport({ pageCount: 4 });
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: documentKey },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    const descriptor = JSON.parse(result.outputText(SLOT.descriptor)) as PdfDescriptor;
    expect(descriptor.pages).toEqual(pageKeys);
  });
});

describe('PDF export processor — validation failures (no Artifact produced)', () => {
  it('fails on a malformed Document input', async () => {
    const { harness } = setupPdfExport();
    const badDocKey = harness.seedText('{ not a document }');
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: badDocKey },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.error.kind).toBe('permanent');
  });

  it('fails on a missing page reference', async () => {
    const { harness } = setupPdfExport();
    // A document referencing a page artifact that was never seeded.
    const doc = buildDocument({
      metadata: { albumId: 'album-1', title: 'X' },
      printProfile: samplePrintProfile(),
      pages: [{ index: 0, artifact: 'sha256:' + '9'.repeat(64) }],
    });
    if (!doc.ok) throw new Error('doc build failed');
    const key = harness.seedText(serializeDocument(doc.value.document));
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: key },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.error.message).toMatch(/missing page artifact/);
  });

  it('fails on inconsistent page sizes', async () => {
    const { harness } = setupPdfExport();
    const k0 = harness.seed(encodeRaster(solidRaster(8, 8, [1, 2, 3])));
    const k1 = harness.seed(encodeRaster(solidRaster(16, 8, [4, 5, 6]))); // different width
    const doc = buildDocument({
      metadata: { albumId: 'album-1', title: 'X' },
      printProfile: samplePrintProfile(),
      pages: [
        { index: 0, artifact: k0 },
        { index: 1, artifact: k1 },
      ],
    });
    if (!doc.ok) throw new Error('doc build failed');
    const key = harness.seedText(serializeDocument(doc.value.document));
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: key },
      config: {},
      expectedOutputs: OUTPUTS,
    });
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.error.message).toMatch(/inconsistent page sizes/);
  });

  it('fails on unsupported export configuration', async () => {
    const { harness, documentKey } = setupPdfExport();
    const result = await harness.execute(pdfExportSpec, {
      inputs: { [SLOT.document]: documentKey },
      config: { compression: 'zip' },
      expectedOutputs: OUTPUTS,
    });
    expect(result.outcome.ok).toBe(false);
    if (!result.outcome.ok) expect(result.outcome.error.kind).toBe('permanent');
  });
});
