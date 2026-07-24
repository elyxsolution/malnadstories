import type { Brand } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';

/**
 * The DOCUMENT MODEL — the immutable, deterministic, content-addressable representation of a fully
 * rendered album ready for export, expressed as ORDERED references to rendered Page Artifacts plus
 * the metadata / print configuration / assembly configuration that define it. It is completely
 * FORMAT-INDEPENDENT: it describes what the document IS, never how it is exported (PDF, preview,
 * print package — all downstream). Pure data — no rendering, no rasterization, no export, no
 * storage.
 */

/** The document SCHEMA version (semver). Part of the canonical content — a bump changes identity. */
export const DOCUMENT_SCHEMA_VERSION = '1.0.0';

/** A document's content-addressed IDENTITY: `sha256:<hex>` of its canonical serialization. */
export type DocumentHash = Brand<string, 'DocumentHash'>;

/** How a page functions in the document. A cover, when present, is the first page. */
export type PageKind = 'cover' | 'page';

export const PAGE_KINDS: readonly PageKind[] = ['cover', 'page'];

/**
 * One ordered page: its position, the identity of the rendered Page Artifact it references (a
 * content address — the page is NOT embedded), its kind, and an optional provenance link back to
 * the blueprint surface it was composed from.
 */
export interface DocumentPage {
  readonly index: number;
  readonly artifact: StorageKey;
  readonly kind: PageKind;
  readonly surfaceId?: string;
}

/** Document-level metadata. `pageCount` is builder-enforced to equal the page count. */
export interface DocumentMetadata {
  readonly albumId: string;
  readonly title: string;
  readonly pageCount: number;
}

/** The colour space the document is prepared for. */
export type PrintColorSpace = 'srgb' | 'cmyk' | 'gray';

export const PRINT_COLOR_SPACES: readonly PrintColorSpace[] = ['srgb', 'cmyk', 'gray'];

/** The concrete print SETTINGS — geometry + resolution + colour + bleed the pages are prepared at. */
export interface PrintSettings {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly dpi: number;
  readonly colorSpace: PrintColorSpace;
  readonly bleed: number;
}

/** A named PRINT PROFILE bundling the print settings (the profile the document was assembled for). */
export interface PrintProfile {
  readonly id: string;
  readonly name: string;
  readonly settings: PrintSettings;
}

/** How pages are ordered in the document. `sequential` = strictly by ascending page index. */
export type PageOrdering = 'sequential';

export const PAGE_ORDERINGS: readonly PageOrdering[] = ['sequential'];

/** The ASSEMBLY configuration — how the pages are assembled into the document. */
export interface AssemblyConfig {
  readonly ordering: PageOrdering;
  readonly duplex: boolean;
  readonly includeCover: boolean;
}

/**
 * A validated, immutable DOCUMENT: the schema version, document metadata, the print profile
 * (settings), arbitrary print metadata, the assembly configuration, and the ordered pages
 * (canonically sorted by index). Constructed only by the builder or the parse/validation boundary;
 * always deep-frozen. Its identity is a pure function of its canonical content.
 */
export interface Document {
  readonly schemaVersion: string;
  readonly metadata: DocumentMetadata;
  readonly printProfile: PrintProfile;
  readonly printMetadata: Readonly<Record<string, string>>;
  readonly assembly: AssemblyConfig;
  readonly pages: readonly DocumentPage[];
}

// --- Document Manifest (the ordered page-reference listing) ---

export const DOCUMENT_MANIFEST_SCHEMA = 'workerv2.document.manifest/1';

/** A single ordered page reference in the document manifest. */
export interface DocumentPageRef {
  readonly index: number;
  readonly artifact: StorageKey;
  readonly kind: PageKind;
}

/** The DOCUMENT MANIFEST — the immutable, ordered list of the page Artifacts the document assembles. */
export interface DocumentManifest {
  readonly schema: typeof DOCUMENT_MANIFEST_SCHEMA;
  readonly albumId: string;
  readonly pageCount: number;
  readonly pages: readonly DocumentPageRef[];
}

// --- Document Descriptor (the deterministic, replayable record) ---

export const DOCUMENT_DESCRIPTOR_SCHEMA = 'workerv2.document.descriptor/1';

/**
 * The DOCUMENT DESCRIPTOR — a deterministic, JSON-safe record of a document: its identity, ordered
 * page references, print profile, document metadata, and assembly configuration. Supports replay,
 * debugging, validation, auditing, and future export pipelines. The document platform produces it;
 * it never produces an export format.
 */
export interface DocumentDescriptor {
  readonly schema: typeof DOCUMENT_DESCRIPTOR_SCHEMA;
  readonly hash: DocumentHash;
  readonly schemaVersion: string;
  readonly metadata: DocumentMetadata;
  readonly printProfile: PrintProfile;
  readonly printMetadata: Readonly<Record<string, string>>;
  readonly assembly: AssemblyConfig;
  readonly pages: readonly DocumentPageRef[];
}
