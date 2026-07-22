import type { StorageKey } from '@workerv2/infra-contracts';
import type { Blueprint, BlueprintNode, BlueprintNodeId } from './model.js';
import { childrenOf, nodeById } from './model.js';

/**
 * BLUEPRINT GRAPH helpers — pure, read-only traversals over a validated blueprint. Because a
 * blueprint's containment is a validated tree, traversal is total and deterministic
 * (depth-first, children in semantic order).
 */

/** Depth-first traversal from the root (root first, children in order). */
export function walkBlueprint(blueprint: Blueprint): readonly BlueprintNode[] {
  const out: BlueprintNode[] = [];
  const visit = (id: BlueprintNodeId): void => {
    const node = nodeById(blueprint, id);
    if (node === undefined) return; // impossible on a validated blueprint
    out.push(node);
    for (const child of childrenOf(node)) visit(child);
  };
  visit(blueprint.root);
  return out;
}

/** Every artifact identity a blueprint references, deduplicated + sorted (deterministic). */
export function referencedArtifacts(blueprint: Blueprint): readonly StorageKey[] {
  const keys = new Set<string>();
  for (const node of blueprint.nodes) {
    if (node.kind === 'placement') keys.add(node.artifact);
  }
  return [...keys].sort() as StorageKey[];
}

/** Total physical leaves the blueprint's spreads consume (Σ spread.pages). */
export function totalPages(blueprint: Blueprint): number {
  return blueprint.nodes.reduce((sum, n) => (n.kind === 'spread' ? sum + n.pages : sum), 0);
}
