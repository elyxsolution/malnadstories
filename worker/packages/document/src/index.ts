// @workerv2/document — the Document Assembly Platform. The immutable, content-addressable layer
// that assembles rendered Page Artifacts into a complete, FORMAT-INDEPENDENT printable document
// model — the bridge between rendering and export. Document aggregate + builder + document manifest
// + page ordering + print metadata/settings/profile + assembly config + validation + canonical
// serialization + sha256 identity + Document Descriptor + a test harness.
//
// It references rendered pages by content-addressed identity; it does NOT render, rasterize, or
// process images, generate PDFs or previews, package print files, perform storage or networking, or
// introduce business logic. Future exporters consume the same immutable Document as independent
// processors — the platform is unaware of them.

// --- Model / contracts ---
export type {
  DocumentHash,
  PageKind,
  DocumentPage,
  DocumentMetadata,
  PrintColorSpace,
  PrintSettings,
  PrintProfile,
  PageOrdering,
  AssemblyConfig,
  Document,
  DocumentPageRef,
  DocumentManifest,
  DocumentDescriptor,
} from './model.js';
export {
  DOCUMENT_SCHEMA_VERSION,
  PAGE_KINDS,
  PRINT_COLOR_SPACES,
  PAGE_ORDERINGS,
  DOCUMENT_MANIFEST_SCHEMA,
  DOCUMENT_DESCRIPTOR_SCHEMA,
} from './model.js';

// --- Errors ---
export { DocumentError } from './errors.js';

// --- Validation ---
export { validateDocument } from './validate.js';

// --- Canonical serialization ---
export { serializeDocument, parseDocument } from './serialize.js';

// --- Content-addressable identity ---
export { DOCUMENT_HASH_ALGORITHM, hashDocument } from './identity.js';

// --- Builder ---
export { buildDocument } from './build.js';
export type { DocumentPageInput, DocumentSource, AssembledDocument } from './build.js';

// --- Document manifest + descriptor ---
export { toDocumentManifest } from './manifest.js';
export { describeDocument } from './descriptor.js';

// --- Test harness (reusable fixtures) ---
export {
  fakePageKey,
  SAMPLE_PRINT_PROFILE,
  samplePageInputs,
  sampleDocumentSource,
} from './harness.js';
