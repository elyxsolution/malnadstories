import type { JsonObject, JsonValue, Result } from '@workerv2/contracts';
import { ok, deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  ArtifactInputBinding,
  CancellationPolicy,
  FailurePolicy,
  RetryPolicy,
  StepId,
  TimeoutPolicy,
} from '@workerv2/processing';
import { DEFAULT_CANCELLATION, DEFAULT_FAILURE_POLICY, NO_RETRY } from '@workerv2/processing';
import type { Blueprint, BlueprintNode } from '@workerv2/blueprint';
import { childrenOf, hashBlueprint, nodeById as blueprintNodeById } from '@workerv2/blueprint';
import type { ManifestError } from './errors.js';
import { MANIFEST_SCHEMA_VERSION } from './model.js';
import type { Manifest, ManifestHash, WorkNode } from './model.js';
import { validateManifest } from './validate.js';
import { serializeManifest } from './serialize.js';
import { hashManifest } from './identity.js';

/**
 * The MANIFEST COMPILER — entirely DECLARATIVE: it consumes a validated Blueprint and
 * produces the immutable description of the executable work that realizes it. It translates
 * blueprint INTENT into processing INTENT and nothing more: no rendering, no image
 * processing, no scheduling, no execution — processors are referenced by registry NAME and
 * interpreted by an engine in a later phase.
 *
 * The canonical translation (deterministic; same blueprint → same manifest → same identity):
 *  - one `surface.render` node per surface (cover + each spread), consuming the BLUEPRINT
 *    ITSELF as a content-addressed artifact (a canonical blueprint stored as an artifact has
 *    key = its own hash — ADR-0008) plus every image artifact placed on that surface, and
 *    producing one `page` output;
 *  - one `album.assemble` node consuming every surface's `page` output in semantic order,
 *    producing the final `album` output.
 *
 * Self-containment (INV-3 enabler): every consumed input is a content address or an
 * in-manifest node output — an engine needs the manifest + the artifact store, nothing else.
 */

/** Processor registry names — the translation vocabulary (data; an engine binds them later). */
export const RENDER_SURFACE_PROCESSOR = 'surface.render';
export const ASSEMBLE_ALBUM_PROCESSOR = 'album.assemble';

/** Runtime capabilities the generated work declares (structurally = runtime negotiation shape). */
export const RENDER_CAPABILITY = 'render.surface';
export const ASSEMBLE_CAPABILITY = 'render.assemble';

/** Derived node-id vocabulary (stable ids — the diff model depends on them). */
export const RENDER_NODE_PREFIX = 'render:';
export const ASSEMBLE_NODE_ID = 'assemble:album';

/** Well-known slot names. */
export const BLUEPRINT_INPUT = 'blueprint';
export const PAGE_OUTPUT = 'page';
export const ALBUM_OUTPUT = 'album';

/** Optional declarative policies applied to every generated node (defaults: no retry, cooperative cancellation). */
export interface ManifestPolicies {
  readonly retry?: RetryPolicy;
  readonly timeout?: TimeoutPolicy;
  readonly cancellation?: CancellationPolicy;
  readonly failure?: FailurePolicy;
}

export interface ManifestCompileOptions {
  readonly policies?: ManifestPolicies;
  /**
   * Free-form provenance (e.g. a future resolver-chain trace). Attached to the COMPILED
   * wrapper only — it is NOT part of the manifest value and can NEVER affect its identity.
   */
  readonly trace?: JsonValue;
}

/** The compiler's product: the validated manifest + its canonical form + identity, frozen. */
export interface CompiledManifest {
  readonly manifest: Manifest;
  readonly hash: ManifestHash;
  readonly canonical: string;
  /** Optional provenance riding alongside the manifest — excluded from `canonical` and `hash`. */
  readonly trace?: JsonValue;
}

interface SurfaceWork {
  readonly surfaceId: string;
  readonly node: BlueprintNode;
}

function surfacesOf(blueprint: Blueprint): readonly SurfaceWork[] {
  const root = blueprintNodeById(blueprint, blueprint.root);
  if (root === undefined) return [];
  const out: SurfaceWork[] = [];
  for (const childId of childrenOf(root)) {
    const child = blueprintNodeById(blueprint, childId);
    if (child === undefined) continue;
    if (child.kind === 'cover' || child.kind === 'spread') {
      out.push({ surfaceId: child.id, node: child });
    }
  }
  return out;
}

/**
 * Compile a validated blueprint into a `CompiledManifest`. The assembled manifest is routed
 * through the FULL validation gate (`validateManifest`) — the compiler cannot emit a
 * manifest that violates any invariant — then canonicalized, hashed, and deep-frozen.
 */
export function compileManifest(
  blueprint: Blueprint,
  options: ManifestCompileOptions = {},
): Result<CompiledManifest, ManifestError> {
  const blueprintHash = hashBlueprint(blueprint);
  const blueprintBinding: ArtifactInputBinding = {
    kind: 'artifact',
    key: blueprintHash as string as StorageKey,
  };
  const policies = {
    retry: options.policies?.retry ?? NO_RETRY,
    ...(options.policies?.timeout === undefined ? {} : { timeout: options.policies.timeout }),
    cancellation: options.policies?.cancellation ?? DEFAULT_CANCELLATION,
    failure: options.policies?.failure ?? DEFAULT_FAILURE_POLICY,
  };

  const surfaces = surfacesOf(blueprint);
  const nodes: WorkNode[] = [];
  const renderIds: StepId[] = [];
  const assembleConsumes: Record<string, ArtifactInputBinding> = {
    [BLUEPRINT_INPUT]: blueprintBinding,
  };

  for (const { surfaceId, node } of surfaces) {
    const renderId = `${RENDER_NODE_PREFIX}${surfaceId}` as StepId;
    const consumes: Record<string, ArtifactInputBinding> = {
      [BLUEPRINT_INPUT]: blueprintBinding,
    };
    for (const childId of childrenOf(node)) {
      const child = blueprintNodeById(blueprint, childId);
      if (child === undefined || child.kind !== 'placement') continue;
      consumes[`image:${child.slot}`] = { kind: 'artifact', key: child.artifact };
    }
    const config: JsonObject =
      node.kind === 'spread' ? { surface: surfaceId, pages: node.pages } : { surface: surfaceId };
    nodes.push({
      id: renderId,
      processor: RENDER_SURFACE_PROCESSOR,
      dependsOn: [],
      consumes,
      produces: [PAGE_OUTPUT],
      requires: [{ name: RENDER_CAPABILITY }],
      config,
      ...policies,
    });
    renderIds.push(renderId);
    assembleConsumes[`page:${surfaceId}`] = {
      kind: 'step-output',
      stepId: renderId,
      output: PAGE_OUTPUT,
    };
  }

  nodes.push({
    id: ASSEMBLE_NODE_ID as StepId,
    processor: ASSEMBLE_ALBUM_PROCESSOR,
    dependsOn: [...renderIds].sort(),
    consumes: assembleConsumes,
    produces: [ALBUM_OUTPUT],
    requires: [{ name: ASSEMBLE_CAPABILITY }],
    // Semantic surface order lives here (arrays keep order in canonical JSON).
    config: { surfaces: surfaces.map((s) => s.surfaceId) },
    ...policies,
  });

  // Canonical node order: sorted by id (M4).
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const assembled = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    albumId: blueprint.albumId,
    blueprint: blueprintHash as string,
    nodes,
  };

  // The single validation gate — compiler output passes every invariant or is rejected.
  const validated = validateManifest(assembled);
  if (!validated.ok) return validated;

  const manifest = validated.value;
  const compiled: CompiledManifest = {
    manifest,
    hash: hashManifest(manifest),
    canonical: serializeManifest(manifest),
    ...(options.trace === undefined ? {} : { trace: options.trace }),
  };
  deepFreeze(compiled);
  return ok(compiled);
}

/**
 * Attach (or replace) a provenance trace on a compiled manifest. Returns a NEW frozen
 * wrapper — the manifest, canonical form, and hash are carried over UNCHANGED, so a trace
 * can never affect manifest identity.
 */
export function attachTrace(compiled: CompiledManifest, trace: JsonValue): CompiledManifest {
  const next: CompiledManifest = {
    manifest: compiled.manifest,
    hash: compiled.hash,
    canonical: compiled.canonical,
    trace,
  };
  deepFreeze(next);
  return next;
}
