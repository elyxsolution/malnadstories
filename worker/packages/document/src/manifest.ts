import { deepFreeze } from '@workerv2/utils';
import { DOCUMENT_MANIFEST_SCHEMA } from './model.js';
import type { Document, DocumentManifest, DocumentPageRef } from './model.js';

/**
 * The DOCUMENT MANIFEST — the immutable, ordered listing of the rendered Page Artifacts a document
 * assembles (index → artifact identity). A pure projection of the document's already-canonical page
 * order; it exposes "what pages, in what order" without the print/assembly configuration, for
 * consumers (e.g. a future export processor) that only need the page references.
 */
export function toDocumentManifest(document: Document): DocumentManifest {
  const pages: DocumentPageRef[] = document.pages.map((page) => ({
    index: page.index,
    artifact: page.artifact,
    kind: page.kind,
  }));
  const manifest: DocumentManifest = {
    schema: DOCUMENT_MANIFEST_SCHEMA,
    albumId: document.metadata.albumId,
    pageCount: document.pages.length,
    pages,
  };
  deepFreeze(manifest);
  return manifest;
}
