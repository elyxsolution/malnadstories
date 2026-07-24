import type { Result } from '@workerv2/contracts';
import { err, canonicalJson } from '@workerv2/utils';
import { DocumentError } from './errors.js';
import type { Document } from './model.js';
import { validateDocument } from './validate.js';

/**
 * CANONICAL SERIALIZATION — the byte form a document's identity is computed from. Object keys
 * sorted, arrays in semantic order (pages are already canonically ordered by index), no whitespace:
 * structurally-equal documents always serialize byte-identically, so serialization is deterministic
 * and identity is content-only (no timestamps, no environment state).
 */
export function serializeDocument(document: Document): string {
  return canonicalJson(document);
}

/**
 * Parse a serialized document back through the FULL validation gate (every invariant). The
 * round-trip is stable: `serialize(parse(serialize(doc))) === serialize(doc)`, and any key order in
 * the incoming JSON is irrelevant — the canonical form is recomputed, never trusted.
 */
export function parseDocument(json: string): Result<Document, DocumentError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return err(new DocumentError('Document JSON is not parseable', { cause }));
  }
  return validateDocument(raw);
}
