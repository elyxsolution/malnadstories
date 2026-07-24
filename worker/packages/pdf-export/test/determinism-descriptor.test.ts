import { describe, it, expect } from 'vitest';
import type { JsonObject } from '@workerv2/contracts';
import { canonicalJson } from '@workerv2/utils';
import {
  pdfExportSpec,
  SLOT,
  buildPdfDescriptor,
  parsePdfExportConfig,
  PDF_DESCRIPTOR_SCHEMA,
  setupPdfExport,
} from '@workerv2/pdf-export';

const OUTPUTS = [SLOT.pdf, SLOT.descriptor];

async function exportOnce(config: JsonObject = {}): Promise<{
  pdf: Uint8Array;
  pdfKey: string;
  descriptor: string;
}> {
  const { harness, documentKey } = setupPdfExport({ pageCount: 3 });
  const result = await harness.execute(pdfExportSpec, {
    inputs: { [SLOT.document]: documentKey },
    config,
    expectedOutputs: OUTPUTS,
  });
  if (!result.outcome.ok) throw new Error('export failed');
  return {
    pdf: result.outputBytes(SLOT.pdf),
    pdfKey: result.outcome.value.outputs[SLOT.pdf] as string,
    descriptor: result.outputText(SLOT.descriptor),
  };
}

describe('deterministic output + artifact identity', () => {
  it('identical Document + config + processor → byte-identical PDF + same Artifact identity', async () => {
    const a = await exportOnce();
    const b = await exportOnce();
    expect(Array.from(a.pdf)).toEqual(Array.from(b.pdf));
    expect(a.pdfKey).toBe(b.pdfKey); // content-addressed → equivalent exports = identical Artifact
  });

  it('different export config → different PDF Artifact', async () => {
    const base = await exportOnce();
    const bled = await exportOnce({ bleed: 12 });
    expect(base.pdfKey).not.toBe(bled.pdfKey);
  });

  it('replay consistency: the descriptor round-trips and is stable across runs', async () => {
    const a = await exportOnce({ bleed: 6 });
    const b = await exportOnce({ bleed: 6 });
    expect(a.descriptor).toBe(b.descriptor);
    // The descriptor is valid JSON recording the export.
    const parsed = JSON.parse(a.descriptor) as { schema: string; pdfVersion: string };
    expect(parsed.schema).toBe(PDF_DESCRIPTOR_SCHEMA);
    expect(parsed.pdfVersion).toBe('1.7');
  });
});

describe('buildPdfDescriptor — deterministic + serializable', () => {
  it('records document identity, ordered pages, config, pdf + processor version', () => {
    const { document } = setupPdfExport({ pageCount: 2 });
    const config = parsePdfExportConfig({ bleed: 4 });
    if (!config.ok) throw new Error('config');
    const descriptor = buildPdfDescriptor(document, config.value);
    expect(descriptor).toMatchObject({
      schema: PDF_DESCRIPTOR_SCHEMA,
      document: expect.stringMatching(/^sha256:/),
      pdfVersion: '1.7',
      processor: '1.0.0',
    });
    expect(descriptor.pages).toHaveLength(2);
    // Pure + serializable (canonical form is stable).
    const again = buildPdfDescriptor(document, config.value);
    expect(canonicalJson(descriptor)).toBe(canonicalJson(again));
    expect(Object.isFrozen(descriptor)).toBe(true);
  });
});
