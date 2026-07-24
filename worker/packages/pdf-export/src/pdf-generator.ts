import { deflateSync } from 'node:zlib';
import type { ResolvedPdfConfig } from './config.js';
import { PDF_EXPORTER_VERSION } from './config.js';
import { PdfBuilder, ascii, pdfTextString, streamObject } from './pdf-writer.js';
import type { PdfImage } from './pdf-image.js';

/**
 * The PDF GENERATOR / ASSEMBLY ENGINE — turns placed page images + info metadata + export config
 * into deterministic PDF bytes. It owns: page placement (each image drawn to fill its media box,
 * inset by bleed), the metadata writer (a fixed `Producer`, no dates), optional crop marks, and the
 * compression policy. All numbers are integers and all identity-affecting values are controlled
 * here, so the output is byte-identical for identical inputs.
 */

/** A page ready for placement: its packed image + target size in POINTS. */
export interface GeneratorPage {
  readonly image: PdfImage;
  readonly widthPt: number;
  readonly heightPt: number;
}

/** Info-dictionary metadata (Producer is always overridden; there are no dates). */
export interface PdfInfo {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
  readonly creator?: string;
}

/** The fixed Producer string — pins the exporter version and prevents library-injected metadata. */
export const PDF_PRODUCER = `Worker V2 PDF Exporter ${PDF_EXPORTER_VERSION}`;

export function generatePdf(
  pages: readonly GeneratorPage[],
  info: PdfInfo,
  config: ResolvedPdfConfig,
): Uint8Array {
  const pdf = new PdfBuilder();
  const catalog = pdf.reserve(); // 1
  const pagesNode = pdf.reserve(); // 2

  const pageNums: number[] = [];
  for (const page of pages) {
    const imageNum = addImage(pdf, page.image, config);
    const contentNum = pdf.add(contentStream(page, config));
    const pageNum = pdf.add(pageDict(page, pagesNode, imageNum, contentNum, config));
    pageNums.push(pageNum);
  }

  const infoNum = pdf.add(infoDict(info));
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesNode} 0 R >>`);
  pdf.set(
    pagesNode,
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`,
  );

  return pdf.serialize({ pdfVersion: config.pdfVersion, root: catalog, info: infoNum });
}

// --- Objects ---

function addImage(pdf: PdfBuilder, image: PdfImage, config: ResolvedPdfConfig): number {
  const smaskNum =
    image.smask === undefined
      ? null
      : pdf.add(
          streamObject(
            `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
              `/ColorSpace /DeviceGray /BitsPerComponent 8${filterKey(config)}`,
            encode(image.smask, config),
          ),
        );

  const dict =
    `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
    `/ColorSpace /${image.colorSpace} /BitsPerComponent 8` +
    (smaskNum === null ? '' : ` /SMask ${smaskNum} 0 R`) +
    filterKey(config);
  return pdf.add(streamObject(dict, encode(image.samples, config)));
}

function contentStream(page: GeneratorPage, config: ResolvedPdfConfig): Uint8Array {
  const b = config.bleed;
  const draw = `q\n${page.widthPt} 0 0 ${page.heightPt} ${b} ${b} cm\n/Im0 Do\nQ\n`;
  const marks = config.cropMarks ? cropMarks(b, page.widthPt, page.heightPt) : '';
  return streamObject('', ascii(draw + marks));
}

function pageDict(
  page: GeneratorPage,
  parent: number,
  imageNum: number,
  contentNum: number,
  config: ResolvedPdfConfig,
): string {
  const b = config.bleed;
  const mw = page.widthPt + 2 * b;
  const mh = page.heightPt + 2 * b;
  const trim = `[${b} ${b} ${b + page.widthPt} ${b + page.heightPt}]`;
  return (
    `<< /Type /Page /Parent ${parent} 0 R ` +
    `/MediaBox [0 0 ${mw} ${mh}] /BleedBox [0 0 ${mw} ${mh}] /TrimBox ${trim} ` +
    `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
  );
}

function infoDict(info: PdfInfo): string {
  const entries: string[] = [`/Producer ${pdfTextString(PDF_PRODUCER)}`];
  if (info.title !== undefined) entries.push(`/Title ${pdfTextString(info.title)}`);
  if (info.author !== undefined) entries.push(`/Author ${pdfTextString(info.author)}`);
  if (info.subject !== undefined) entries.push(`/Subject ${pdfTextString(info.subject)}`);
  if (info.keywords !== undefined) entries.push(`/Keywords ${pdfTextString(info.keywords)}`);
  if (info.creator !== undefined) entries.push(`/Creator ${pdfTextString(info.creator)}`);
  return `<< ${entries.join(' ')} >>`;
}

// --- Placement helpers ---

/** Four corner crop marks at the trim box, drawn into the bleed (a fixed 18pt mark length). */
function cropMarks(bleed: number, widthPt: number, heightPt: number): string {
  const len = 18;
  const x0 = bleed;
  const y0 = bleed;
  const x1 = bleed + widthPt;
  const y1 = bleed + heightPt;
  const line = (ax: number, ay: number, bx: number, by: number): string =>
    `${ax} ${ay} m ${bx} ${by} l S\n`;
  return (
    '0 0 0 RG\n0.5 w\n' +
    // bottom-left
    line(x0 - len, y0, x0, y0) +
    line(x0, y0 - len, x0, y0) +
    // bottom-right
    line(x1, y0, x1 + len, y0) +
    line(x1, y0 - len, x1, y0) +
    // top-left
    line(x0 - len, y1, x0, y1) +
    line(x0, y1, x0, y1 + len) +
    // top-right
    line(x1, y1, x1 + len, y1) +
    line(x1, y1, x1, y1 + len)
  );
}

function filterKey(config: ResolvedPdfConfig): string {
  return config.compression === 'flate' ? ' /Filter /FlateDecode' : '';
}

function encode(data: Uint8Array, config: ResolvedPdfConfig): Uint8Array {
  return config.compression === 'flate' ? new Uint8Array(deflateSync(data, { level: 9 })) : data;
}
