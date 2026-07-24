// PDF EXPORT TEST HARNESS — reusable scaffolding for exercising the exporter end to end without any
// real rendering or storage. It seeds page rasters into an in-memory Artifact gateway, assembles a
// valid Document referencing them, seeds the Document, and hands back everything a test (or a future
// exporter) needs to run the processor. Ships in `src` (no test framework imported).

import type { StorageKey } from '@workerv2/infra-contracts';
import { ProcessorHarness } from '@workerv2/processor-sdk';
import type { Document, DocumentPageInput, PrintProfile } from '@workerv2/document';
import { buildDocument, serializeDocument } from '@workerv2/document';
import type { RasterImage } from '@workerv2/image-backend';
import { encodeRaster, solidRaster } from '@workerv2/image-backend';

export interface PdfExportSetup {
  readonly harness: ProcessorHarness;
  readonly documentKey: StorageKey;
  readonly document: Document;
  readonly pageKeys: readonly StorageKey[];
}

export interface PdfExportSetupOptions {
  readonly pageCount?: number;
  readonly withCover?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly dpi?: number;
}

/** A deterministic solid-colour page raster whose colour varies by index (so pages are distinct). */
export function samplePageRaster(index: number, width = 8, height = 8): RasterImage {
  const r = (index * 40 + 10) & 0xff;
  const g = (index * 25 + 30) & 0xff;
  const b = (index * 15 + 60) & 0xff;
  return solidRaster(width, height, [r, g, b]);
}

/** A print profile whose pixel geometry matches the sample page rasters. */
export function samplePrintProfile(width = 8, height = 8, dpi = 72): PrintProfile {
  return {
    id: 'test-profile',
    name: 'Test Profile',
    settings: { pageWidth: width, pageHeight: height, dpi, colorSpace: 'srgb', bleed: 0 },
  };
}

/** Seed pages + an assembled Document into a fresh harness and return the wiring. */
export function setupPdfExport(options: PdfExportSetupOptions = {}): PdfExportSetup {
  const { pageCount = 3, withCover = false, width = 8, height = 8, dpi = 72 } = options;
  const harness = new ProcessorHarness();

  const pageKeys: StorageKey[] = [];
  const pages: DocumentPageInput[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const key = harness.seed(encodeRaster(samplePageRaster(i, width, height)));
    pageKeys.push(key);
    pages.push({ index: i, artifact: key, kind: withCover && i === 0 ? 'cover' : 'page' });
  }

  const built = buildDocument({
    metadata: { albumId: 'album-1', title: 'Harness Album' },
    printProfile: samplePrintProfile(width, height, dpi),
    printMetadata: { paper: 'test' },
    pages,
  });
  if (!built.ok) throw new Error(`harness: failed to build document: ${built.error.message}`);

  const documentKey = harness.seedText(serializeDocument(built.value.document));
  return { harness, documentKey, document: built.value.document, pageKeys };
}
