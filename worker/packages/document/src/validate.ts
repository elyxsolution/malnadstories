import type { Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import { DocumentError } from './errors.js';
import {
  DOCUMENT_SCHEMA_VERSION,
  PAGE_KINDS,
  PAGE_ORDERINGS,
  PRINT_COLOR_SPACES,
} from './model.js';
import type {
  AssemblyConfig,
  Document,
  DocumentMetadata,
  DocumentPage,
  PageKind,
  PrintColorSpace,
  PrintProfile,
  PrintSettings,
} from './model.js';

/**
 * DOCUMENT VALIDATION — the single gate every document passes before it exists (the builder routes
 * its own output through here too). It reconstructs a CLEAN, canonical, deep-frozen `Document` from
 * arbitrary input (unknown keys dropped, so they can never reach identity) and enforces the
 * DOCUMENT INVARIANTS:
 *
 *  D1  supported schema version
 *  D2  metadata complete: album id + title present + bounded; pageCount = page count
 *  D3  print profile + settings consistent (positive geometry/dpi, known colour space, bleed ≥ 0)
 *  D4  print metadata is a bounded string→string map
 *  D5  assembly configuration valid (known ordering; boolean flags)
 *  D6  every page has a content-addressed artifact reference (none missing) + valid kind/index
 *  D7  page ordering valid: indices are exactly 0..n−1 — contiguous, unique (no duplicates)
 *  D8  at most one cover, and if present it is page 0; assembly.includeCover matches
 */

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ARTIFACT_KEY_RE = /^[a-z0-9-]+:[0-9a-f]+$/;
const MAX_ID = 200;
const MAX_TITLE = 300;
const MAX_PAGES = 5000;
const MAX_DIM = 200_000;
const MAX_DPI = 4800;
const MAX_BLEED = 100_000;
const MAX_META_ENTRIES = 100;
const MAX_META_LEN = 1000;

export function validateDocument(raw: unknown): Result<Document, DocumentError> {
  if (!isObject(raw)) return bad('document must be an object');

  if (raw['schemaVersion'] !== DOCUMENT_SCHEMA_VERSION) {
    return bad(`unsupported document schema version (expected ${DOCUMENT_SCHEMA_VERSION})`);
  }

  const printProfile = validatePrintProfile(raw['printProfile']);
  if (!printProfile.ok) return printProfile;

  const printMetadata = validatePrintMetadata(raw['printMetadata']);
  if (!printMetadata.ok) return printMetadata;

  const assembly = validateAssembly(raw['assembly']);
  if (!assembly.ok) return assembly;

  const pages = validatePages(raw['pages']);
  if (!pages.ok) return pages;

  const coverCheck = validateCover(pages.value, assembly.value);
  if (!coverCheck.ok) return coverCheck;

  const metadata = validateMetadata(raw['metadata'], pages.value.length);
  if (!metadata.ok) return metadata;

  const document: Document = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: metadata.value,
    printProfile: printProfile.value,
    printMetadata: printMetadata.value,
    assembly: assembly.value,
    pages: pages.value,
  };
  deepFreeze(document);
  return ok(document);
}

// --- Sections ---

function validateMetadata(
  raw: unknown,
  pageCount: number,
): Result<DocumentMetadata, DocumentError> {
  if (!isObject(raw)) return bad('metadata must be an object');
  const albumId = raw['albumId'];
  if (!isToken(albumId, MAX_ID)) return bad('metadata.albumId is missing or invalid');
  const title = raw['title'];
  if (!isNonEmptyString(title, MAX_TITLE)) return bad('metadata.title is missing or invalid');
  const declared = raw['pageCount'];
  if (declared !== undefined && declared !== pageCount) {
    return bad(
      `metadata.pageCount (${String(declared)}) does not match the page count (${pageCount})`,
    );
  }
  return ok({ albumId, title, pageCount });
}

function validatePrintProfile(raw: unknown): Result<PrintProfile, DocumentError> {
  if (!isObject(raw)) return bad('printProfile must be an object');
  const id = raw['id'];
  if (!isToken(id, MAX_ID)) return bad('printProfile.id is missing or invalid');
  const name = raw['name'];
  if (!isNonEmptyString(name, MAX_TITLE)) return bad('printProfile.name is missing or invalid');
  const settings = validatePrintSettings(raw['settings']);
  if (!settings.ok) return settings;
  return ok({ id, name, settings: settings.value });
}

function validatePrintSettings(raw: unknown): Result<PrintSettings, DocumentError> {
  if (!isObject(raw)) return bad('printProfile.settings must be an object');
  const pageWidth = raw['pageWidth'];
  const pageHeight = raw['pageHeight'];
  if (!isPositiveInt(pageWidth, MAX_DIM) || !isPositiveInt(pageHeight, MAX_DIM)) {
    return bad('print settings pageWidth/pageHeight must be positive integers within range');
  }
  const dpi = raw['dpi'];
  if (!isPositiveInt(dpi, MAX_DPI)) return bad('print settings dpi must be a positive integer');
  const colorSpace = raw['colorSpace'];
  if (!isColorSpace(colorSpace)) return bad('print settings colorSpace is invalid');
  const bleed = raw['bleed'];
  if (!isNonNegativeInt(bleed, MAX_BLEED)) return bad('print settings bleed must be a ≥0 integer');
  return ok({ pageWidth, pageHeight, dpi, colorSpace, bleed });
}

function validatePrintMetadata(
  raw: unknown,
): Result<Readonly<Record<string, string>>, DocumentError> {
  if (raw === undefined) return ok({});
  if (!isObject(raw)) return bad('printMetadata must be an object');
  // Sort keys so the reconstructed map has a canonical insertion order (determinism of the object
  // form, matching the canonical-JSON identity which already sorts keys).
  const entries = Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length > MAX_META_ENTRIES) return bad('printMetadata has too many entries');
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > MAX_META_LEN)
      return bad(`printMetadata key "${key}" invalid`);
    if (typeof value !== 'string' || value.length > MAX_META_LEN) {
      return bad(`printMetadata value for "${key}" must be a bounded string`);
    }
    out[key] = value;
  }
  return ok(out);
}

function validateAssembly(raw: unknown): Result<AssemblyConfig, DocumentError> {
  if (!isObject(raw)) return bad('assembly must be an object');
  const ordering = raw['ordering'];
  if (typeof ordering !== 'string' || !(PAGE_ORDERINGS as readonly string[]).includes(ordering)) {
    return bad('assembly.ordering is invalid');
  }
  if (typeof raw['duplex'] !== 'boolean') return bad('assembly.duplex must be a boolean');
  if (typeof raw['includeCover'] !== 'boolean')
    return bad('assembly.includeCover must be a boolean');
  return ok({
    ordering: ordering as PageOrdering,
    duplex: raw['duplex'],
    includeCover: raw['includeCover'],
  });
}

function validatePages(raw: unknown): Result<readonly DocumentPage[], DocumentError> {
  if (!Array.isArray(raw)) return bad('pages must be an array');
  if (raw.length === 0) return bad('a document must have at least one page');
  if (raw.length > MAX_PAGES) return bad('document has too many pages');

  const parsed: DocumentPage[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i += 1) {
    const page = validatePage(raw[i], i);
    if (!page.ok) return page;
    if (seen.has(page.value.index)) return bad(`duplicate page index ${page.value.index}`);
    seen.add(page.value.index);
    parsed.push(page.value);
  }

  // Canonical order: strictly by index; indices must be exactly 0..n-1 (no gaps).
  parsed.sort((a, b) => a.index - b.index);
  for (let i = 0; i < parsed.length; i += 1) {
    if (parsed[i]?.index !== i) return bad('page indices must be contiguous starting at 0');
  }
  return ok(parsed);
}

function validatePage(raw: unknown, at: number): Result<DocumentPage, DocumentError> {
  if (!isObject(raw)) return bad(`page ${at} must be an object`);
  const index = raw['index'];
  if (!isNonNegativeInt(index, MAX_PAGES)) return bad(`page ${at}: index must be a ≥0 integer`);
  const artifact = raw['artifact'];
  if (typeof artifact !== 'string' || !ARTIFACT_KEY_RE.test(artifact)) {
    return bad(`page ${at}: artifact must be a content-addressed key (missing/invalid reference)`);
  }
  const kind = raw['kind'];
  if (!isPageKind(kind)) return bad(`page ${at}: kind must be one of ${PAGE_KINDS.join('/')}`);
  const surfaceId = raw['surfaceId'];
  if (surfaceId !== undefined && !isToken(surfaceId, MAX_ID)) {
    return bad(`page ${at}: surfaceId is invalid`);
  }
  const page: DocumentPage = {
    index,
    artifact: artifact as StorageKey,
    kind,
    ...(surfaceId === undefined ? {} : { surfaceId }),
  };
  return ok(page);
}

function validateCover(
  pages: readonly DocumentPage[],
  assembly: AssemblyConfig,
): Result<void, DocumentError> {
  const covers = pages.filter((p) => p.kind === 'cover');
  if (covers.length > 1) return bad('a document may have at most one cover');
  const hasCover = covers.length === 1;
  if (hasCover && covers[0]?.index !== 0) return bad('the cover, when present, must be page 0');
  if (assembly.includeCover !== hasCover) {
    return bad('assembly.includeCover is inconsistent with the presence of a cover page');
  }
  return ok(undefined);
}

// --- Predicates ---

type PageOrdering = (typeof PAGE_ORDERINGS)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function isToken(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && TOKEN_RE.test(value);
}
function isPositiveInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max;
}
function isNonNegativeInt(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}
function isColorSpace(value: unknown): value is PrintColorSpace {
  return typeof value === 'string' && (PRINT_COLOR_SPACES as readonly string[]).includes(value);
}
function isPageKind(value: unknown): value is PageKind {
  return typeof value === 'string' && (PAGE_KINDS as readonly string[]).includes(value);
}

function bad(message: string): Result<never, DocumentError> {
  return err(new DocumentError(message));
}
