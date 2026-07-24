import type { Result } from '@workerv2/contracts';
import { buildDocument } from '@workerv2/document';
import type { AssembledDocument, DocumentSource } from '@workerv2/document';
import { sampleDocumentSource } from '@workerv2/document';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap on Err: ${String(r.error)}`);
  return r.value;
}

/** Build a document from a (possibly overridden) sample source, unwrapping the success. */
export function assemble(overrides: Partial<DocumentSource> = {}): AssembledDocument {
  return unwrap(buildDocument(sampleDocumentSource(overrides)));
}
