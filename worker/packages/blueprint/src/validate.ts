import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { makeAlbumId } from '@workerv2/control-plane';
import type { StorageKey } from '@workerv2/infra-contracts';
import { BlueprintError } from './errors.js';
import { ALLOWED_CHILD_KINDS, BLUEPRINT_SCHEMA_VERSION } from './model.js';
import type {
  Blueprint,
  BlueprintNode,
  BlueprintNodeId,
  BlueprintNodeKind,
  BlueprintRect,
} from './model.js';

/**
 * BLUEPRINT VALIDATION — the single gate every blueprint passes before it exists (the compiler
 * routes its own output through here too). Enforces the BLUEPRINT INVARIANTS:
 *
 *  I1  supported schema version
 *  I2  valid album id
 *  I3  nodes non-empty, unique ids, sorted by id (canonical node order)
 *  I4  exactly one root, kind 'album', and it is the only album node
 *  I5  no dangling references; children respect the containment kind rules
 *  I6  containment is a TREE reachable from the root (every non-root node has exactly one
 *      parent; no cycles; no disconnected nodes)
 *  I7  STABLE IDS: every id is exactly its derived structural id (`album`, `cover`,
 *      `spread:NNNN`, `<parent>:placement:<slot>`, `<parent>:text:NNNN`)
 *  I8  spreads are contiguous (index = position; ≥ 1 spread; cover, if present, first)
 *  I9  placement slots valid + unique per surface; artifact keys content-address shaped
 *  I10 frames normalized to [0,1] with positive size; text content bounded
 */

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ARTIFACT_KEY_RE = /^[a-z0-9-]+:[0-9a-f]+$/;
const MAX_TITLE = 200;
const MAX_TEXT = 2000;
const MAX_SLOT = 100;

export function padIndex(index: number): string {
  return String(index).padStart(4, '0');
}

function bad<T>(
  message: string,
  context?: Record<string, string | number>,
): Result<T, BlueprintError> {
  return err(new BlueprintError(message, context === undefined ? {} : { context }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseRect(v: unknown, where: string): Result<BlueprintRect, BlueprintError> {
  if (!isRecord(v)) return bad(`${where}: frame must be an object`);
  const { x, y, w, h } = v;
  if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h)) {
    return bad(`${where}: frame components must be finite numbers`);
  }
  if (x < 0 || x > 1 || y < 0 || y > 1 || w <= 0 || w > 1 || h <= 0 || h > 1) {
    return bad(`${where}: frame must be normalized to [0,1] with positive size`, {
      x,
      y,
      w,
      h,
    });
  }
  return ok({ x, y, w, h });
}

function parseNode(v: unknown, position: number): Result<BlueprintNode, BlueprintError> {
  if (!isRecord(v)) return bad(`Node at position ${position} must be an object`);
  const { id, kind } = v;
  if (!isStr(id) || id.length === 0 || id.length > 400) {
    return bad(`Node at position ${position} has an invalid id`);
  }
  const where = `Node "${id}"`;
  switch (kind) {
    case 'album': {
      if (!isStr(v.title) || v.title.trim().length === 0 || v.title.length > MAX_TITLE) {
        return bad(`${where}: album title must be a non-empty string (<= ${MAX_TITLE} chars)`);
      }
      const children = parseChildren(v.children, where);
      if (!children.ok) return children;
      return ok({ id: id as BlueprintNodeId, kind, title: v.title, children: children.value });
    }
    case 'cover': {
      const children = parseChildren(v.children, where);
      if (!children.ok) return children;
      return ok({ id: id as BlueprintNodeId, kind, children: children.value });
    }
    case 'spread': {
      if (!isNum(v.index) || !Number.isInteger(v.index) || v.index < 0) {
        return bad(`${where}: spread index must be a non-negative integer`);
      }
      if (v.pages !== 1 && v.pages !== 2) {
        return bad(`${where}: spread pages must be 1 or 2`);
      }
      const children = parseChildren(v.children, where);
      if (!children.ok) return children;
      return ok({
        id: id as BlueprintNodeId,
        kind,
        index: v.index,
        pages: v.pages,
        children: children.value,
      });
    }
    case 'placement': {
      if (!isStr(v.slot) || v.slot.length > MAX_SLOT || !TOKEN_RE.test(v.slot)) {
        return bad(`${where}: placement slot must be a valid token`);
      }
      if (!isStr(v.artifact) || !ARTIFACT_KEY_RE.test(v.artifact)) {
        return bad(`${where}: placement artifact must be a content-addressed key (alg:hexdigest)`);
      }
      const frame = parseRect(v.frame, where);
      if (!frame.ok) return frame;
      return ok({
        id: id as BlueprintNodeId,
        kind,
        slot: v.slot,
        artifact: v.artifact as StorageKey,
        frame: frame.value,
      });
    }
    case 'text': {
      if (!isStr(v.content) || v.content.length === 0 || v.content.length > MAX_TEXT) {
        return bad(`${where}: text content must be a non-empty string (<= ${MAX_TEXT} chars)`);
      }
      const frame = parseRect(v.frame, where);
      if (!frame.ok) return frame;
      return ok({ id: id as BlueprintNodeId, kind, content: v.content, frame: frame.value });
    }
    default:
      return bad(`${where}: unknown node kind "${String(kind)}"`);
  }
}

function parseChildren(
  v: unknown,
  where: string,
): Result<readonly BlueprintNodeId[], BlueprintError> {
  if (!Array.isArray(v)) return bad(`${where}: children must be an array`);
  const out: BlueprintNodeId[] = [];
  for (const child of v) {
    if (!isStr(child) || child.length === 0) return bad(`${where}: children must be node ids`);
    out.push(child as BlueprintNodeId);
  }
  return ok(out);
}

/** The full untrusted-input boundary: parse + every invariant. */
export function validateBlueprint(input: unknown): Result<Blueprint, BlueprintError> {
  if (!isRecord(input)) return bad('Blueprint must be an object');
  const { schemaVersion, albumId, root, nodes } = input;

  // I1 — schema version
  if (schemaVersion !== BLUEPRINT_SCHEMA_VERSION) {
    return bad(`Unsupported blueprint schema version "${String(schemaVersion)}"`, {
      supported: BLUEPRINT_SCHEMA_VERSION,
    });
  }
  // I2 — album id
  if (!isStr(albumId)) return bad('Blueprint albumId must be a string');
  const album = makeAlbumId(albumId);
  if (!album.ok) return bad(`Blueprint albumId invalid: ${album.error.message}`);

  if (!isStr(root)) return bad('Blueprint root must be a node id');
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return bad('Blueprint nodes must be a non-empty array');
  }

  // Parse nodes structurally.
  const parsed: BlueprintNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = parseNode(nodes[i], i);
    if (!node.ok) return node;
    parsed.push(node.value);
  }

  // I3 — unique, sorted ids.
  const byId = new Map<string, BlueprintNode>();
  for (const node of parsed) {
    if (byId.has(node.id)) return bad(`Duplicate node id "${node.id}"`);
    byId.set(node.id, node);
  }
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    if (prev !== undefined && curr !== undefined && !(prev.id < curr.id)) {
      return bad(`Nodes must be sorted by id ("${curr.id}" after "${prev.id}")`);
    }
  }

  // I4 — single root of kind album; the only album node.
  const rootNode = byId.get(root);
  if (rootNode === undefined) return bad(`Root node "${root}" not found`);
  if (rootNode.kind !== 'album') return bad('Root node must have kind "album"');
  const albumNodes = parsed.filter((n) => n.kind === 'album');
  if (albumNodes.length !== 1) return bad('Blueprint must contain exactly one album node');
  if (rootNode.id !== 'album') return bad('Album node id must be "album" (stable id, I7)');

  // I5 + I6 — references resolve, kinds allowed, tree with full reachability.
  const parentCount = new Map<string, number>();
  for (const node of parsed) {
    const children = node.kind === 'placement' || node.kind === 'text' ? [] : node.children;
    const seen = new Set<string>();
    for (const childId of children) {
      if (seen.has(childId)) {
        return bad(`Node "${node.id}" lists child "${childId}" more than once`);
      }
      seen.add(childId);
      const child = byId.get(childId);
      if (child === undefined) {
        return bad(`Node "${node.id}" references missing child "${childId}" (dangling reference)`);
      }
      const allowed: readonly BlueprintNodeKind[] = ALLOWED_CHILD_KINDS[node.kind] ?? [];
      if (!allowed.includes(child.kind)) {
        return bad(`Node "${node.id}" (${node.kind}) may not contain "${childId}" (${child.kind})`);
      }
      parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
    }
  }
  if ((parentCount.get(rootNode.id) ?? 0) !== 0) {
    return bad('Root node must not be referenced as a child');
  }
  for (const node of parsed) {
    if (node.id === rootNode.id) continue;
    const count = parentCount.get(node.id) ?? 0;
    if (count === 0) return bad(`Node "${node.id}" is unreachable (no parent)`);
    if (count > 1)
      return bad(`Node "${node.id}" has ${count} parents (containment must be a tree)`);
  }
  // BFS reachability (a tree by counts could still hide a detached cycle in theory).
  const reachable = new Set<string>([rootNode.id]);
  const queue: BlueprintNode[] = [rootNode];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    const children = node.kind === 'placement' || node.kind === 'text' ? [] : node.children;
    for (const childId of children) {
      if (!reachable.has(childId)) {
        reachable.add(childId);
        const child = byId.get(childId);
        if (child !== undefined) queue.push(child);
      }
    }
  }
  if (reachable.size !== parsed.length) {
    return bad('Blueprint contains nodes unreachable from the root');
  }

  // I8 — album children: optional cover first, then contiguous spreads; ≥ 1 spread.
  const albumChildren = rootNode.children.map((id) => byId.get(id));
  let spreadPosition = 0;
  let sawSpread = false;
  for (let i = 0; i < albumChildren.length; i++) {
    const child = albumChildren[i];
    if (child === undefined) continue; // dangling already rejected
    if (child.kind === 'cover') {
      if (i !== 0) return bad('Cover must be the first child of the album');
      if (child.id !== 'cover') return bad('Cover node id must be "cover" (stable id, I7)');
      continue;
    }
    if (child.kind !== 'spread') return bad('Album children must be a cover and/or spreads');
    sawSpread = true;
    if (child.index !== spreadPosition) {
      return bad(
        `Spread indexes must be contiguous: expected ${spreadPosition}, got ${child.index}`,
      );
    }
    // I7 — stable spread id.
    const expectedId = `spread:${padIndex(child.index)}`;
    if (child.id !== expectedId) {
      return bad(`Spread id must be "${expectedId}" (stable id, I7), got "${child.id}"`);
    }
    spreadPosition++;
  }
  if (!sawSpread) return bad('Blueprint must contain at least one spread');

  // I7 + I9 — leaf ids derived from parent; slots unique per surface; text ids indexed.
  for (const node of parsed) {
    if (node.kind !== 'cover' && node.kind !== 'spread') continue;
    let lastSlot: string | null = null;
    let textIndex = 0;
    let sawText = false;
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child === undefined) continue;
      if (child.kind === 'placement') {
        if (sawText) {
          return bad(`Surface "${node.id}": placements must precede texts (deterministic order)`);
        }
        if (lastSlot !== null && !(lastSlot < child.slot)) {
          return bad(
            `Surface "${node.id}": placement slots must be unique and sorted ("${child.slot}" after "${lastSlot}")`,
          );
        }
        lastSlot = child.slot;
        const expected = `${node.id}:placement:${child.slot}`;
        if (child.id !== expected) {
          return bad(`Placement id must be "${expected}" (stable id, I7), got "${child.id}"`);
        }
      } else if (child.kind === 'text') {
        sawText = true;
        const expected = `${node.id}:text:${padIndex(textIndex)}`;
        if (child.id !== expected) {
          return bad(`Text id must be "${expected}" (stable id, I7), got "${child.id}"`);
        }
        textIndex++;
      }
    }
  }

  const blueprint: Blueprint = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    albumId,
    root: root as BlueprintNodeId,
    nodes: parsed,
  };
  return ok(blueprint);
}
