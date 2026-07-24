import { deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { Document } from '@workerv2/document';
import { hashDocument } from '@workerv2/document';
import type { ResolvedPdfConfig } from './config.js';
import { PDF_EXPORTER_VERSION } from './config.js';

/**
 * The PDF DESCRIPTOR — a deterministic, JSON-safe record of a PDF export: the source document
 * identity, the ordered page identities, the export configuration, the target PDF version, and the
 * processor version. It records everything needed to REPLAY, AUDIT, and DEBUG an export (and to
 * explain the resulting Artifact's identity) and nothing environment-dependent. A pure function of
 * the document + config — two equivalent exports yield identical descriptors.
 */

export const PDF_DESCRIPTOR_SCHEMA = 'workerv2.pdf-export.descriptor/1';

export interface PdfDescriptor {
  readonly schema: typeof PDF_DESCRIPTOR_SCHEMA;
  readonly document: string;
  readonly pages: readonly StorageKey[];
  readonly config: ResolvedPdfConfig;
  readonly pdfVersion: string;
  readonly processor: string;
}

/** Build the deterministic PDF descriptor for a document + resolved export config. */
export function buildPdfDescriptor(document: Document, config: ResolvedPdfConfig): PdfDescriptor {
  const descriptor: PdfDescriptor = {
    schema: PDF_DESCRIPTOR_SCHEMA,
    document: hashDocument(document),
    pages: document.pages.map((page) => page.artifact),
    config,
    pdfVersion: config.pdfVersion,
    processor: PDF_EXPORTER_VERSION,
  };
  deepFreeze(descriptor);
  return descriptor;
}
