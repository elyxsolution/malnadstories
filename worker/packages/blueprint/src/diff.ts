import { canonicalJson, deepFreeze } from '@workerv2/utils';
import type { Blueprint, BlueprintNodeId } from './model.js';

/**
 * The BLUEPRINT DIFF model — a deterministic, structural comparison of two blueprints by
 * STABLE node id (which is why ids are derived, never random). Pure data out: which nodes were
 * added, removed, or changed (same id, different canonical content). Sorted, frozen,
 * symmetric-by-construction (`diff(a,b).added === diff(b,a).removed`).
 */
export interface BlueprintDiff {
  /** True iff the two blueprints have identical canonical content (same identity). */
  readonly identical: boolean;
  readonly added: readonly BlueprintNodeId[];
  readonly removed: readonly BlueprintNodeId[];
  readonly changed: readonly BlueprintNodeId[];
}

export function diffBlueprints(a: Blueprint, b: Blueprint): BlueprintDiff {
  const canonicalA = new Map<string, string>(a.nodes.map((n) => [n.id, canonicalJson(n)]));
  const canonicalB = new Map<string, string>(b.nodes.map((n) => [n.id, canonicalJson(n)]));

  const added: BlueprintNodeId[] = [];
  const removed: BlueprintNodeId[] = [];
  const changed: BlueprintNodeId[] = [];

  for (const id of canonicalA.keys()) {
    const other = canonicalB.get(id);
    if (other === undefined) removed.push(id as BlueprintNodeId);
    else if (other !== canonicalA.get(id)) changed.push(id as BlueprintNodeId);
  }
  for (const id of canonicalB.keys()) {
    if (!canonicalA.has(id)) added.push(id as BlueprintNodeId);
  }

  added.sort();
  removed.sort();
  changed.sort();

  const identical =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    canonicalJson(a) === canonicalJson(b);

  const diff: BlueprintDiff = { identical, added, removed, changed };
  deepFreeze(diff);
  return diff;
}
