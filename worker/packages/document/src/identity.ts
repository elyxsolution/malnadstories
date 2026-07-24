import { createHash } from 'node:crypto';
import type { Document, DocumentHash } from './model.js';
import { serializeDocument } from './serialize.js';

/**
 * DOCUMENT IDENTITY — content addressing for documents: `sha256:<hex>` over the UTF-8 bytes of the
 * canonical serialization. Identity therefore depends ONLY on canonical document content — the
 * ordered page artifact identities, the document metadata, and the print configuration — never on
 * time, storage, or process state. It is byte-compatible with the artifact platform's addressing
 * scheme (ADR-0006), so the document is itself just another immutable, content-addressed artifact:
 * a canonical document stored as an artifact gets a storage key equal to its own hash.
 *
 * Equivalent documents always produce identical hashes.
 */
export const DOCUMENT_HASH_ALGORITHM = 'sha256';

export function hashDocument(document: Document): DocumentHash {
  const canonical = serializeDocument(document);
  const digest = createHash(DOCUMENT_HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
  return `${DOCUMENT_HASH_ALGORITHM}:${digest}` as DocumentHash;
}
