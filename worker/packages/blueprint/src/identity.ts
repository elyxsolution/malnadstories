import { createHash } from 'node:crypto';
import type { Blueprint, BlueprintHash } from './model.js';
import { serializeBlueprint } from './serialize.js';

/**
 * BLUEPRINT IDENTITY — content addressing for blueprints: `sha256:<hex>` over the UTF-8 bytes
 * of the canonical serialization. Identity therefore depends ONLY on canonical blueprint
 * content — never on time, storage, or process state — and is byte-compatible with the
 * artifact platform's addressing scheme (ADR-0006), so a canonical blueprint stored as an
 * artifact gets a storage key equal to its own hash.
 */
export const BLUEPRINT_HASH_ALGORITHM = 'sha256';

export function hashBlueprint(blueprint: Blueprint): BlueprintHash {
  const canonical = serializeBlueprint(blueprint);
  const digest = createHash(BLUEPRINT_HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
  return `${BLUEPRINT_HASH_ALGORITHM}:${digest}` as BlueprintHash;
}
