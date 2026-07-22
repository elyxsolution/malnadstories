import type { Result } from '@workerv2/contracts';
import { ok, deepFreeze } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { BlueprintError } from './errors.js';
import { BLUEPRINT_SCHEMA_VERSION } from './model.js';
import type {
  Blueprint,
  BlueprintHash,
  BlueprintNode,
  BlueprintNodeId,
  BlueprintRect,
} from './model.js';
import { validateBlueprint, padIndex } from './validate.js';
import { serializeBlueprint } from './serialize.js';
import { hashBlueprint } from './identity.js';

/**
 * The BLUEPRINT COMPILER — entirely DECLARATIVE: it consumes a domain-shaped source
 * description and produces an immutable blueprint graph. It makes no processing/rendering
 * decisions (frames arrive resolved; no layout is computed), executes nothing, and stores
 * nothing. Deterministic: the same source always compiles to the same blueprint — and
 * therefore the same content-addressed identity. Placement declaration order is
 * NON-semantic (canonicalized by slot); spread order and text order ARE semantic.
 */

export interface PlacementSource {
  readonly slot: string;
  /** Content-addressed identity of the (canonical) image artifact. */
  readonly artifact: string;
  readonly frame: BlueprintRect;
}

export interface TextSource {
  readonly content: string;
  readonly frame: BlueprintRect;
}

export interface SurfaceSource {
  readonly placements?: readonly PlacementSource[];
  readonly texts?: readonly TextSource[];
}

export interface SpreadSource extends SurfaceSource {
  /** Physical leaves this unit consumes (1 = single page, 2 = double spread). */
  readonly pages: 1 | 2;
}

export interface BlueprintSource {
  readonly albumId: string;
  readonly title: string;
  readonly cover?: SurfaceSource;
  readonly spreads: readonly SpreadSource[];
}

/** The compiler's product: the validated blueprint + its canonical form + identity, frozen. */
export interface CompiledBlueprint {
  readonly blueprint: Blueprint;
  readonly hash: BlueprintHash;
  readonly canonical: string;
}

/** Build one surface's children (placements canonicalized by slot, then texts in order). */
function buildSurfaceChildren(
  surfaceId: string,
  surface: SurfaceSource,
  nodes: BlueprintNode[],
): readonly BlueprintNodeId[] {
  const children: BlueprintNodeId[] = [];
  const placements = [...(surface.placements ?? [])].sort((a, b) =>
    a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0,
  );
  for (const placement of placements) {
    const id = `${surfaceId}:placement:${placement.slot}` as BlueprintNodeId;
    nodes.push({
      id,
      kind: 'placement',
      slot: placement.slot,
      artifact: placement.artifact as StorageKey,
      frame: placement.frame,
    });
    children.push(id);
  }
  (surface.texts ?? []).forEach((text, index) => {
    const id = `${surfaceId}:text:${padIndex(index)}` as BlueprintNodeId;
    nodes.push({ id, kind: 'text', content: text.content, frame: text.frame });
    children.push(id);
  });
  return children;
}

/**
 * Compile a source into a `CompiledBlueprint`. The assembled graph is routed through the FULL
 * validation gate (`validateBlueprint`) — the compiler cannot emit a blueprint that violates
 * any invariant — then canonicalized, hashed, and deep-frozen.
 */
export function compileBlueprint(
  source: BlueprintSource,
): Result<CompiledBlueprint, BlueprintError> {
  const nodes: BlueprintNode[] = [];
  const albumChildren: BlueprintNodeId[] = [];

  if (source.cover !== undefined) {
    const coverId = 'cover' as BlueprintNodeId;
    const children = buildSurfaceChildren('cover', source.cover, nodes);
    nodes.push({ id: coverId, kind: 'cover', children });
    albumChildren.push(coverId);
  }

  source.spreads.forEach((spread, index) => {
    const spreadId = `spread:${padIndex(index)}` as BlueprintNodeId;
    const children = buildSurfaceChildren(spreadId, spread, nodes);
    nodes.push({ id: spreadId, kind: 'spread', index, pages: spread.pages, children });
    albumChildren.push(spreadId);
  });

  nodes.push({
    id: 'album' as BlueprintNodeId,
    kind: 'album',
    title: source.title,
    children: albumChildren,
  });

  // Canonical node order: sorted by id (I3).
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const assembled = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    albumId: source.albumId,
    root: 'album',
    nodes,
  };

  // The single validation gate — compiler output passes every invariant or is rejected.
  const validated = validateBlueprint(assembled);
  if (!validated.ok) return validated;

  const blueprint = validated.value;
  const canonical = serializeBlueprint(blueprint);
  const hash = hashBlueprint(blueprint);
  const compiled: CompiledBlueprint = { blueprint, hash, canonical };
  deepFreeze(compiled);
  return ok(compiled);
}
