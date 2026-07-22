// @workerv2/contracts — shared foundational types (neutral home). Types-only + the
// contracts version constant. No runtime behavior, no product knowledge.

export type { Ok, Err, Result } from './result.js';
export type { Brand } from './brand.js';
export type { JsonPrimitive, JsonValue, JsonObject, JsonArray } from './json.js';
export type { Disposable, DeepReadonly } from './lifecycle.js';
export type { SemVer } from './version.js';
export { CONTRACTS_VERSION } from './version.js';
