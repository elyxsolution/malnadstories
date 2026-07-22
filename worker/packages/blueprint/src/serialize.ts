import type { Result } from '@workerv2/contracts';
import { err, canonicalJson } from '@workerv2/utils';
import { BlueprintError } from './errors.js';
import type { Blueprint } from './model.js';
import { validateBlueprint } from './validate.js';

/**
 * CANONICAL SERIALIZATION — the byte form a blueprint's identity is computed from. Object keys
 * sorted, arrays in semantic order, no whitespace: structurally-equal blueprints always
 * serialize byte-identically, so serialization is deterministic and identity is content-only.
 */
export function serializeBlueprint(blueprint: Blueprint): string {
  return canonicalJson(blueprint);
}

/**
 * Parse a serialized blueprint back through the FULL validation gate (every invariant). The
 * round-trip is stable: `serialize(parse(serialize(bp))) === serialize(bp)`, and any key order
 * in the incoming JSON is irrelevant — canonical form is recomputed, never trusted.
 */
export function parseBlueprint(json: string): Result<Blueprint, BlueprintError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return err(new BlueprintError('Blueprint JSON is not parseable', { cause }));
  }
  return validateBlueprint(raw);
}
