import type { Result } from '@workerv2/contracts';
import { ok } from '@workerv2/utils';
import { DocumentError } from './errors.js';
import { DOCUMENT_SCHEMA_VERSION } from './model.js';
import type { AssemblyConfig, Document, DocumentHash, PageKind, PrintProfile } from './model.js';
import { validateDocument } from './validate.js';
import { serializeDocument } from './serialize.js';
import { hashDocument } from './identity.js';

/**
 * The DOCUMENT BUILDER — assembles rendered Page Artifact references into an immutable, validated,
 * content-addressed `Document`. It CONSUMES page identities (never the bytes — no storage, no
 * rendering), applies deterministic assembly defaults, routes the assembled candidate through the
 * single validation gate (so an invalid/incomplete document can never be produced), then computes
 * the canonical form + hash and returns the frozen result. Pure: no timestamps, no randomness, no
 * environment-dependent behavior.
 */

/** One page to assemble: its position + the rendered Page Artifact identity (+ kind/provenance). */
export interface DocumentPageInput {
  readonly index: number;
  readonly artifact: string;
  readonly kind?: PageKind;
  readonly surfaceId?: string;
}

/** The inputs the builder assembles a document from. `metadata.pageCount` is derived, not supplied. */
export interface DocumentSource {
  readonly metadata: { readonly albumId: string; readonly title: string };
  readonly printProfile: PrintProfile;
  readonly printMetadata?: Readonly<Record<string, string>>;
  readonly assembly?: Partial<AssemblyConfig>;
  readonly pages: readonly DocumentPageInput[];
}

/** The builder's product: the validated document + its canonical form + identity, all frozen. */
export interface AssembledDocument {
  readonly document: Document;
  readonly hash: DocumentHash;
  readonly canonical: string;
}

/** Assemble a source into an `AssembledDocument`, or fail (invalid documents never exist). */
export function buildDocument(source: DocumentSource): Result<AssembledDocument, DocumentError> {
  if (source === null || typeof source !== 'object') {
    return { ok: false, error: new DocumentError('document source must be an object') };
  }

  const pages = (source.pages ?? []).map((page) => ({
    index: page.index,
    artifact: page.artifact,
    kind: page.kind ?? 'page',
    ...(page.surfaceId === undefined ? {} : { surfaceId: page.surfaceId }),
  }));

  const hasCover = pages.some((page) => page.kind === 'cover');
  const assembly: AssemblyConfig = {
    ordering: source.assembly?.ordering ?? 'sequential',
    duplex: source.assembly?.duplex ?? false,
    includeCover: source.assembly?.includeCover ?? hasCover,
  };

  const candidate = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    metadata: {
      albumId: source.metadata?.albumId,
      title: source.metadata?.title,
      pageCount: pages.length,
    },
    printProfile: source.printProfile,
    printMetadata: source.printMetadata ?? {},
    assembly,
    pages,
  };

  const validated = validateDocument(candidate);
  if (!validated.ok) return validated;

  const document = validated.value;
  return ok({ document, hash: hashDocument(document), canonical: serializeDocument(document) });
}
