import { canonicalJson, deepFreeze } from '@workerv2/utils';
import type { StepId } from '@workerv2/processing';
import type { Manifest } from './model.js';

/**
 * The MANIFEST DIFF model — a deterministic, structural comparison of two manifests by
 * STABLE node id (ids are derived from blueprint structure, never random). Pure data out:
 * which work nodes were added, removed, or changed (same id, different canonical content).
 * Sorted, frozen, symmetric-by-construction (`diff(a,b).added === diff(b,a).removed`).
 * The `identical` verdict also covers the manifest envelope (album id, blueprint
 * provenance, schema version), not just the node set.
 */
export interface ManifestDiff {
  /** True iff the two manifests have identical canonical content (same identity). */
  readonly identical: boolean;
  readonly added: readonly StepId[];
  readonly removed: readonly StepId[];
  readonly changed: readonly StepId[];
}

export function diffManifests(a: Manifest, b: Manifest): ManifestDiff {
  const canonicalA = new Map<string, string>(a.nodes.map((n) => [n.id, canonicalJson(n)]));
  const canonicalB = new Map<string, string>(b.nodes.map((n) => [n.id, canonicalJson(n)]));

  const added: StepId[] = [];
  const removed: StepId[] = [];
  const changed: StepId[] = [];

  for (const id of canonicalA.keys()) {
    const other = canonicalB.get(id);
    if (other === undefined) removed.push(id as StepId);
    else if (other !== canonicalA.get(id)) changed.push(id as StepId);
  }
  for (const id of canonicalB.keys()) {
    if (!canonicalA.has(id)) added.push(id as StepId);
  }

  added.sort();
  removed.sort();
  changed.sort();

  const identical =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    canonicalJson(a) === canonicalJson(b);

  const diff: ManifestDiff = { identical, added, removed, changed };
  deepFreeze(diff);
  return diff;
}
