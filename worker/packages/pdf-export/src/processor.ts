import { canonicalJson } from '@workerv2/utils';
import { createProcessor, requireConfig, abortPermanent } from '@workerv2/processor-sdk';
import type {
  ProcessorSpec,
  ProcessorDependencies,
  ProcessorContext,
} from '@workerv2/processor-sdk';
import type { Processor } from '@workerv2/processing';
import type { Document } from '@workerv2/document';
import { parseDocument } from '@workerv2/document';
import type { RasterImage } from '@workerv2/image-backend';
import { decodeRaster } from '@workerv2/image-backend';
import { parsePdfExportConfig, PDF_EXPORTER_VERSION } from './config.js';
import type { ResolvedPdfConfig } from './config.js';
import { rasterToPdfImage } from './pdf-image.js';
import { generatePdf } from './pdf-generator.js';
import type { GeneratorPage, PdfInfo } from './pdf-generator.js';
import { validateExportPages, validatePdf } from './validate.js';
import { buildPdfDescriptor } from './descriptor.js';

/**
 * THE PDF EXPORT PROCESSOR — the first concrete document exporter, a normal Processor SDK
 * implementation. It CONSUMES an immutable Document (parsed from its content-addressed artifact),
 * RESOLVES the referenced Page Artifacts (decodes the page raster containers — no rendering, no
 * image processing), ASSEMBLES them into a deterministic PDF, VALIDATES the generated PDF, and
 * PRODUCES an immutable PDF Artifact plus a deterministic PDF Descriptor — both through the SDK's
 * Artifact gateway (never bypassing the Artifact Platform). It modifies no Documents, composes no
 * layouts, and performs no storage/networking of its own.
 *
 * Inputs:  `document` — the canonical Document JSON artifact.
 * Outputs: `pdf` — the PDF Artifact · `descriptor` — the PDF Descriptor (JSON) Artifact.
 */

export const SLOT = { document: 'document', pdf: 'pdf', descriptor: 'descriptor' } as const;

export const pdfExportSpec: ProcessorSpec = {
  descriptor: {
    name: 'document.export.pdf',
    version: PDF_EXPORTER_VERSION,
    description: 'Export an immutable Document to a deterministic PDF Artifact (+ PDF descriptor).',
  },
  requiredInputs: [SLOT.document],
  execute: async (ctx) => {
    const config = requireConfig(ctx, parsePdfExportConfig);

    // --- Consume the immutable Document (read-only; never modified) ---
    const parsed = parseDocument(await ctx.readText(SLOT.document));
    if (!parsed.ok) abortPermanent(`malformed Document: ${parsed.error.message}`);
    const document = parsed.value;

    // --- Resolve referenced Page Artifacts (decode container only — no image processing) ---
    ctx.reportProgress({ fraction: 0.25, phase: 'execute', message: 'resolving pages' });
    const rasters = await resolvePages(ctx, document);

    const consistency = validateExportPages(rasters);
    if (!consistency.ok) abortPermanent(consistency.error);

    // --- Assemble the PDF (deterministic) ---
    ctx.reportProgress({ fraction: 0.6, phase: 'execute', message: 'assembling PDF' });
    const dpi = document.printProfile.settings.dpi;
    const genPages: GeneratorPage[] = rasters.map((raster) => ({
      image: rasterToPdfImage(raster),
      widthPt: config.pageSize?.width ?? points(raster.width, dpi),
      heightPt: config.pageSize?.height ?? points(raster.height, dpi),
    }));
    const pdfBytes = generatePdf(genPages, infoFor(document, config), config);

    // --- Validate the generated PDF before producing the Artifact ---
    const pdfCheck = validatePdf(pdfBytes);
    if (!pdfCheck.ok) abortPermanent(`invalid generated PDF: ${pdfCheck.error}`);

    // --- Produce the immutable Artifacts through the SDK gateway (Artifact Platform) ---
    ctx.reportProgress({ fraction: 0.9, phase: 'finalize', message: 'producing artifacts' });
    const pdfKey = await ctx.produce(pdfBytes, {
      contentType: 'application/pdf',
      kind: 'document',
    });
    const descriptor = buildPdfDescriptor(document, config);
    const descriptorKey = await ctx.produceText(canonicalJson(descriptor), {
      contentType: 'application/json',
      kind: 'other',
    });
    return { [SLOT.pdf]: pdfKey, [SLOT.descriptor]: descriptorKey };
  },
};

/** Build the PDF export processor wired to a host's dependencies. */
export function createPdfExportProcessor(deps: ProcessorDependencies): Processor {
  return createProcessor(pdfExportSpec, deps);
}

// --- Helpers ---

async function resolvePages(ctx: ProcessorContext, document: Document): Promise<RasterImage[]> {
  const rasters: RasterImage[] = [];
  for (const page of document.pages) {
    let bytes: Uint8Array;
    try {
      bytes = await ctx.readKey(page.artifact);
    } catch {
      abortPermanent(`missing page artifact for page ${page.index}`, { artifact: page.artifact });
    }
    try {
      rasters.push(decodeRaster(bytes));
    } catch (error) {
      abortPermanent(`undecodable page artifact for page ${page.index}`, {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rasters;
}

/** Convert pixels to PDF points at the given dpi (deterministic integer rounding). */
function points(pixels: number, dpi: number): number {
  return Math.round((pixels * 72) / dpi);
}

/** Info metadata: config overrides, with the Document title as the default title. */
function infoFor(document: Document, config: ResolvedPdfConfig): PdfInfo {
  const m = config.metadata;
  return {
    title: m.title ?? document.metadata.title,
    ...(m.author === undefined ? {} : { author: m.author }),
    ...(m.subject === undefined ? {} : { subject: m.subject }),
    ...(m.keywords === undefined ? {} : { keywords: m.keywords }),
    ...(m.creator === undefined ? {} : { creator: m.creator }),
  };
}
