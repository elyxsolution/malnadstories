import type { Brand } from '@workerv2/contracts';
import type { StorageKey } from '@workerv2/infra-contracts';

/**
 * The BLUEPRINT MODEL — the immutable, deterministic representation of everything that must be
 * produced for an album, expressed as a typed containment GRAPH (a tree rooted at the album
 * node). Artifact-centric: every image reference is a content-addressed artifact identity
 * (`StorageKey`), never a file. Pure data — no execution, no rendering, no storage.
 */

/** The blueprint SCHEMA version (semver). Part of the canonical content — bumping it changes every blueprint's identity, by design. */
export const BLUEPRINT_SCHEMA_VERSION = '1.0.0';

/**
 * A STABLE node identifier, derived deterministically from the node's structural position
 * (e.g. `album`, `cover`, `spread:0002`, `spread:0002:placement:main`) — never random. Stable
 * ids are what make the diff model meaningful across recompilations.
 */
export type BlueprintNodeId = Brand<string, 'BlueprintNodeId'>;

/** A blueprint's content-addressed IDENTITY: `sha256:<hex>` of its canonical serialization. */
export type BlueprintHash = Brand<string, 'BlueprintHash'>;

/** A normalized rectangle — fractions of the parent surface, each component in [0, 1]. */
export interface BlueprintRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type BlueprintNodeKind = 'album' | 'cover' | 'spread' | 'placement' | 'text';

interface NodeBase {
  readonly id: BlueprintNodeId;
  readonly kind: BlueprintNodeKind;
}

/** The single root: the album being produced. Children: optional cover first, then spreads in sequence. */
export interface AlbumNode extends NodeBase {
  readonly kind: 'album';
  readonly title: string;
  readonly children: readonly BlueprintNodeId[];
}

/** The album cover surface. Children: placements + texts. */
export interface CoverNode extends NodeBase {
  readonly kind: 'cover';
  readonly children: readonly BlueprintNodeId[];
}

/** One page unit in sequence. `pages` = physical leaves consumed (1 = single, 2 = double spread). */
export interface SpreadNode extends NodeBase {
  readonly kind: 'spread';
  readonly index: number;
  readonly pages: 1 | 2;
  readonly children: readonly BlueprintNodeId[];
}

/** A photo placement: an artifact identity composed onto a surface at a normalized frame. */
export interface PlacementNode extends NodeBase {
  readonly kind: 'placement';
  /** The placement's slot name — unique within its parent surface. */
  readonly slot: string;
  /** The content-addressed identity of the (canonical) image artifact to place. */
  readonly artifact: StorageKey;
  readonly frame: BlueprintRect;
}

/** A text element on a surface. Purely content + geometry — styling resolution is NOT a blueprint concern. */
export interface TextNode extends NodeBase {
  readonly kind: 'text';
  readonly content: string;
  readonly frame: BlueprintRect;
}

export type BlueprintNode = AlbumNode | CoverNode | SpreadNode | PlacementNode | TextNode;

/** The kinds each container may hold — the containment rule the validator enforces. */
export const ALLOWED_CHILD_KINDS: Readonly<Record<string, readonly BlueprintNodeKind[]>> = {
  album: ['cover', 'spread'],
  cover: ['placement', 'text'],
  spread: ['placement', 'text'],
  placement: [],
  text: [],
};

/**
 * A validated, immutable BLUEPRINT: the schema version, the album it produces, the root node
 * id, and the node list (sorted by id — the canonical node order; SEQUENCE lives in `children`
 * arrays, whose order is semantic). Constructed only by the compiler or the parse/validation
 * boundary; always deep-frozen.
 */
export interface Blueprint {
  readonly schemaVersion: string;
  readonly albumId: string;
  readonly root: BlueprintNodeId;
  readonly nodes: readonly BlueprintNode[];
}

/** Look up a node by id (nodes are id-sorted; linear scan is fine at blueprint scale). */
export function nodeById(blueprint: Blueprint, id: BlueprintNodeId): BlueprintNode | undefined {
  return blueprint.nodes.find((n) => n.id === id);
}

/** The children ids of a node (empty for leaves). */
export function childrenOf(node: BlueprintNode): readonly BlueprintNodeId[] {
  return node.kind === 'placement' || node.kind === 'text' ? [] : node.children;
}
