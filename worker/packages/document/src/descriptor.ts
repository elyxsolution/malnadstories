import { deepFreeze } from '@workerv2/utils';
import { DOCUMENT_DESCRIPTOR_SCHEMA } from './model.js';
import type { AssembledDocument } from './build.js';
import type { DocumentDescriptor, DocumentPageRef } from './model.js';

/**
 * The DOCUMENT DESCRIPTOR — a deterministic, JSON-safe record of an assembled document: its
 * identity (hash), ordered page references, print profile, document metadata, and assembly
 * configuration. It records everything needed for replay, debugging, validation, auditing, and
 * future export pipelines — and NOTHING about any specific export format. A pure function of the
 * assembled document; two equivalent documents yield identical descriptors.
 */
export function describeDocument(assembled: AssembledDocument): DocumentDescriptor {
  const { document, hash } = assembled;
  const pages: DocumentPageRef[] = document.pages.map((page) => ({
    index: page.index,
    artifact: page.artifact,
    kind: page.kind,
  }));
  const descriptor: DocumentDescriptor = {
    schema: DOCUMENT_DESCRIPTOR_SCHEMA,
    hash,
    schemaVersion: document.schemaVersion,
    metadata: document.metadata,
    printProfile: document.printProfile,
    printMetadata: document.printMetadata,
    assembly: document.assembly,
    pages,
  };
  deepFreeze(descriptor);
  return descriptor;
}
