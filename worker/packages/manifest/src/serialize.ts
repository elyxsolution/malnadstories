import type { Result } from '@workerv2/contracts';
import { err, canonicalJson } from '@workerv2/utils';
import { ManifestError } from './errors.js';
import type { Manifest } from './model.js';
import { validateManifest } from './validate.js';

/**
 * CANONICAL SERIALIZATION — the byte form a manifest's identity is computed from. Object
 * keys sorted, arrays in canonical order (the validation gate enforces canonical array
 * order), no whitespace: structurally-equal manifests always serialize byte-identically, so
 * serialization is deterministic and identity is content-only.
 */
export function serializeManifest(manifest: Manifest): string {
  return canonicalJson(manifest);
}

/**
 * Parse a serialized manifest back through the FULL validation gate (every invariant). The
 * round-trip is stable: `serialize(parse(serialize(m))) === serialize(m)`, and any key order
 * or whitespace in the incoming JSON is irrelevant — canonical form is recomputed, never
 * trusted. Unknown keys are dropped by the gate (they can never reach the identity).
 */
export function parseManifest(json: string): Result<Manifest, ManifestError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return err(new ManifestError('Manifest JSON is not parseable', { cause }));
  }
  return validateManifest(raw);
}
