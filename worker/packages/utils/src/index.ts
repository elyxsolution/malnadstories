// @workerv2/utils — pure, generic, side-effect-free helpers. Depends only on contract types.

export { ok, err, isOk, isErr, mapResult, mapErr, unwrapOr } from './result.js';
export { invariant, assertNever } from './invariant.js';
export { isPlainObject, hasOwn, deepFreeze } from './object.js';
export { canonicalJson } from './canonical-json.js';
