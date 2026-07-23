// @workerv2/manifest — the Manifest Platform: the immutable, deterministic,
// content-addressable description of EXECUTABLE WORK derived from a blueprint. Model +
// processing/dependency graph, declarative compiler (blueprint intent → processing intent),
// validation (invariants M1-M11), canonical serialization, hashing (identity = canonical
// content), schema versioning, diff model, and the bridge into the declarative Processing
// Framework. Pure data + pure functions — NO execution, NO scheduling, NO rendering.

// --- Errors ---
export { ManifestError } from './errors.js';

// --- Model + contracts ---
export type { ManifestHash, WorkNode, Manifest } from './model.js';
export { MANIFEST_SCHEMA_VERSION, nodeById } from './model.js';

// --- Validation (the invariants gate) ---
export { validateManifest } from './validate.js';

// --- Canonical serialization ---
export { serializeManifest, parseManifest } from './serialize.js';

// --- Identity (content addressing) ---
export { MANIFEST_HASH_ALGORITHM, hashManifest } from './identity.js';

// --- Compiler (declarative; blueprint → immutable compiled manifest) ---
export type { ManifestPolicies, ManifestCompileOptions, CompiledManifest } from './compile.js';
export {
  compileManifest,
  attachTrace,
  RENDER_SURFACE_PROCESSOR,
  ASSEMBLE_ALBUM_PROCESSOR,
  RENDER_CAPABILITY,
  ASSEMBLE_CAPABILITY,
  RENDER_NODE_PREFIX,
  ASSEMBLE_NODE_ID,
  BLUEPRINT_INPUT,
  PAGE_OUTPUT,
  ALBUM_OUTPUT,
} from './compile.js';

// --- Graph views (processing + dependency graph; artifact bindings) ---
export type { ProducedOutput } from './graph.js';
export { orderManifest, consumedArtifacts, producedOutputs, terminalNodes } from './graph.js';

// --- Diff model ---
export type { ManifestDiff } from './diff.js';
export { diffManifests } from './diff.js';

// --- Processing bridge (manifest → declarative pipeline) ---
export { toPipelineSpec, toPipeline } from './pipeline.js';
