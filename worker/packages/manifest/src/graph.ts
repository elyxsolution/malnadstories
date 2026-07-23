import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import type { StorageKey } from '@workerv2/infra-contracts';
import type { StepGraphOrder, StepId } from '@workerv2/processing';
import { orderStepGraph } from '@workerv2/processing';
import { ManifestError } from './errors.js';
import type { Manifest } from './model.js';

/**
 * MANIFEST GRAPH helpers — pure, read-only views over a validated manifest's PROCESSING
 * GRAPH (the work nodes) and DEPENDENCY GRAPH (their `dependsOn` edges). Deterministic by
 * construction: ordering reuses the processing framework's Kahn + lexicographic algorithm,
 * so manifests, pipelines, and future engines all agree on one canonical order. Nothing here
 * executes or schedules anything.
 */

/**
 * The deterministic execution ordering of a manifest: a canonical total order plus
 * parallelizable stages (stage N = nodes whose longest dependency chain has length N).
 * A validated manifest is already a proven DAG, so this succeeds for any manifest that
 * exists through the validation gate.
 */
export function orderManifest(manifest: Manifest): Result<StepGraphOrder, ManifestError> {
  const graph = orderStepGraph(manifest.nodes.map((n) => ({ id: n.id, dependsOn: n.dependsOn })));
  if (!graph.ok) {
    return err(new ManifestError(`Manifest ordering failed: ${graph.error.message}`));
  }
  return ok(graph.value);
}

/**
 * Every EXTERNAL artifact identity the manifest consumes (`kind: 'artifact'` bindings),
 * deduplicated + sorted. Includes the source blueprint's own content address (the work nodes
 * consume the blueprint as an artifact). Step-output bindings are internal wiring — their
 * identities exist only at run time — so they are not listed here.
 */
export function consumedArtifacts(manifest: Manifest): readonly StorageKey[] {
  const keys = new Set<string>();
  for (const node of manifest.nodes) {
    for (const binding of Object.values(node.consumes)) {
      if (binding.kind === 'artifact') keys.add(binding.key);
    }
  }
  return [...keys].sort() as StorageKey[];
}

/** One produced output slot of one node (the artifact identity exists only at run time). */
export interface ProducedOutput {
  readonly node: StepId;
  readonly output: string;
}

/** Every output the manifest's work will produce, in canonical (node, output) order. */
export function producedOutputs(manifest: Manifest): readonly ProducedOutput[] {
  const out: ProducedOutput[] = [];
  for (const node of manifest.nodes) {
    for (const output of node.produces) {
      out.push({ node: node.id, output });
    }
  }
  return out;
}

/**
 * The TERMINAL nodes — nodes no other node depends on (sorted). Their outputs are the
 * manifest's final deliverables (for the canonical album translation: `assemble:album`).
 */
export function terminalNodes(manifest: Manifest): readonly StepId[] {
  const dependedOn = new Set<string>();
  for (const node of manifest.nodes) {
    for (const dep of node.dependsOn) dependedOn.add(dep);
  }
  return manifest.nodes
    .map((n) => n.id)
    .filter((id) => !dependedOn.has(id))
    .sort() as StepId[];
}
