// @workerv2/blueprint — the Blueprint Platform: the immutable, deterministic,
// content-addressable representation of everything that must be produced for an album.
// Model + graph, declarative compiler, validation (invariants I1-I10), canonical
// serialization, hashing (identity = canonical content), schema versioning, diff model.
// Pure data + pure functions — NO execution, NO rendering, NO storage.

// --- Errors ---
export { BlueprintError } from './errors.js';

// --- Model + contracts ---
export type {
  BlueprintNodeId,
  BlueprintHash,
  BlueprintRect,
  BlueprintNodeKind,
  AlbumNode,
  CoverNode,
  SpreadNode,
  PlacementNode,
  TextNode,
  BlueprintNode,
  Blueprint,
} from './model.js';
export { BLUEPRINT_SCHEMA_VERSION, ALLOWED_CHILD_KINDS, nodeById, childrenOf } from './model.js';

// --- Validation (the invariants gate) ---
export { validateBlueprint, padIndex } from './validate.js';

// --- Canonical serialization ---
export { serializeBlueprint, parseBlueprint } from './serialize.js';

// --- Identity (content addressing) ---
export { BLUEPRINT_HASH_ALGORITHM, hashBlueprint } from './identity.js';

// --- Compiler (declarative; source → immutable compiled blueprint) ---
export type {
  PlacementSource,
  TextSource,
  SurfaceSource,
  SpreadSource,
  BlueprintSource,
  CompiledBlueprint,
} from './compile.js';
export { compileBlueprint } from './compile.js';

// --- Graph traversals ---
export { walkBlueprint, referencedArtifacts, totalPages } from './graph.js';

// --- Diff model ---
export type { BlueprintDiff } from './diff.js';
export { diffBlueprints } from './diff.js';
