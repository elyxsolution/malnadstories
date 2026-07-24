import type { JsonObject, Result } from '@workerv2/contracts';
import { ok, err, canonicalJson } from '@workerv2/utils';

/**
 * EXPORT CONFIGURATION — the deterministic knobs that shape a PDF export AND that become part of
 * the export identity (identical config → identical PDF bytes → identical Artifact). Config schemas
 * live with the processor (not the SDK): `parsePdfExportConfig` is a pure `Result`-returning parser
 * that fills defaults, rejects unsupported values, and yields a fully-RESOLVED config the generator
 * consumes. `canonicalExportConfig` is the config's canonical form for the export descriptor +
 * identity derivation.
 */

/** The exporter's own version — pinned so a run's PDF is reproducible (stamped into Producer). */
export const PDF_EXPORTER_VERSION = '1.0.0';

export type PdfVersion = '1.4' | '1.5' | '1.6' | '1.7';
export const PDF_VERSIONS: readonly PdfVersion[] = ['1.4', '1.5', '1.6', '1.7'];

/** `none` = raw image streams (byte-identical on every platform); `flate` = deflate (deterministic per zlib). */
export type PdfCompression = 'none' | 'flate';
export const PDF_COMPRESSIONS: readonly PdfCompression[] = ['none', 'flate'];

/** Document-info metadata a caller may embed (all optional; Producer is always overridden). */
export interface PdfExportMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
  readonly creator?: string;
}

/** The raw export config a caller supplies (all optional — defaults applied on resolve). */
export interface PdfExportConfig {
  readonly pdfVersion?: PdfVersion;
  /** Explicit page size in POINTS (1/72"); when omitted, derived from the page rasters + dpi. */
  readonly pageSize?: { readonly width: number; readonly height: number };
  readonly bleed?: number;
  readonly cropMarks?: boolean;
  readonly compression?: PdfCompression;
  readonly metadata?: PdfExportMetadata;
}

/** The fully-resolved config the generator consumes (defaults applied). */
export interface ResolvedPdfConfig {
  readonly pdfVersion: PdfVersion;
  readonly pageSize: { readonly width: number; readonly height: number } | null;
  readonly bleed: number;
  readonly cropMarks: boolean;
  readonly compression: PdfCompression;
  readonly metadata: PdfExportMetadata;
}

const MAX_META = 500;
const MAX_DIM = 100_000;
const MAX_BLEED = 10_000;

export const DEFAULT_PDF_CONFIG: ResolvedPdfConfig = {
  pdfVersion: '1.7',
  pageSize: null,
  bleed: 0,
  cropMarks: false,
  compression: 'none',
  metadata: {},
};

/** Parse + resolve an export config; a bad/unsupported value fails (never a partial config). */
export function parsePdfExportConfig(config: JsonObject): Result<ResolvedPdfConfig, string> {
  const pdfVersion = config['pdfVersion'];
  if (pdfVersion !== undefined && !isPdfVersion(pdfVersion)) {
    return err(`unsupported pdfVersion (expected one of ${PDF_VERSIONS.join('/')})`);
  }
  const compression = config['compression'];
  if (compression !== undefined && !isCompression(compression)) {
    return err(`unsupported compression (expected one of ${PDF_COMPRESSIONS.join('/')})`);
  }
  const bleed = config['bleed'];
  if (bleed !== undefined && !isNonNegativeInt(bleed, MAX_BLEED)) {
    return err('bleed must be a non-negative integer (points)');
  }
  const cropMarks = config['cropMarks'];
  if (cropMarks !== undefined && typeof cropMarks !== 'boolean') {
    return err('cropMarks must be a boolean');
  }
  const pageSize = parsePageSize(config['pageSize']);
  if (!pageSize.ok) return pageSize;
  const metadata = parseMetadata(config['metadata']);
  if (!metadata.ok) return metadata;

  return ok({
    pdfVersion: (pdfVersion as PdfVersion | undefined) ?? DEFAULT_PDF_CONFIG.pdfVersion,
    pageSize: pageSize.value,
    bleed: (bleed as number | undefined) ?? 0,
    cropMarks: (cropMarks as boolean | undefined) ?? false,
    compression: (compression as PdfCompression | undefined) ?? DEFAULT_PDF_CONFIG.compression,
    metadata: metadata.value,
  });
}

/** The canonical form of a resolved config — the byte basis for export identity + the descriptor. */
export function canonicalExportConfig(config: ResolvedPdfConfig): string {
  return canonicalJson(config);
}

// --- Helpers ---

function parsePageSize(
  raw: unknown,
): Result<{ readonly width: number; readonly height: number } | null, string> {
  if (raw === undefined) return ok(null);
  if (typeof raw !== 'object' || raw === null) return err('pageSize must be an object');
  const w = (raw as Record<string, unknown>)['width'];
  const h = (raw as Record<string, unknown>)['height'];
  if (!isPositiveInt(w, MAX_DIM) || !isPositiveInt(h, MAX_DIM)) {
    return err('pageSize.width/height must be positive integers (points)');
  }
  return ok({ width: w, height: h });
}

function parseMetadata(raw: unknown): Result<PdfExportMetadata, string> {
  if (raw === undefined) return ok({});
  if (typeof raw !== 'object' || raw === null) return err('metadata must be an object');
  const out: Record<string, string> = {};
  for (const key of ['title', 'author', 'subject', 'keywords', 'creator'] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > MAX_META) {
      return err(`metadata.${key} must be a string ≤ ${MAX_META} chars`);
    }
    out[key] = value;
  }
  return ok(out);
}

function isPdfVersion(value: unknown): value is PdfVersion {
  return typeof value === 'string' && (PDF_VERSIONS as readonly string[]).includes(value);
}
function isCompression(value: unknown): value is PdfCompression {
  return typeof value === 'string' && (PDF_COMPRESSIONS as readonly string[]).includes(value);
}
function isPositiveInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max;
}
function isNonNegativeInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}
