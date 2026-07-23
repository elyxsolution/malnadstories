import type { JsonObject, JsonValue, Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { makeAlbumId } from '@workerv2/control-plane';
import type { StorageKey } from '@workerv2/infra-contracts';
import type {
  ArtifactInputBinding,
  CancellationPolicy,
  FailurePolicy,
  RetryPolicy,
  StepCapabilityRequirement,
  StepId,
  TimeoutPolicy,
} from '@workerv2/processing';
import {
  isValidCapabilityRequirement,
  isValidSlotName,
  makeStepId,
  orderStepGraph,
  validateCancellationPolicy,
  validateFailurePolicy,
  validateRetryPolicy,
  validateTimeoutPolicy,
} from '@workerv2/processing';
import { ManifestError } from './errors.js';
import { MANIFEST_SCHEMA_VERSION } from './model.js';
import type { Manifest, WorkNode } from './model.js';

/**
 * MANIFEST VALIDATION — the single gate every manifest passes before it exists (the compiler
 * routes its own output through here too). Enforces the MANIFEST INVARIANTS:
 *
 *  M1  supported schema version
 *  M2  valid album id
 *  M3  blueprint provenance is a content address (`sha256:<64 hex>`)
 *  M4  nodes non-empty, unique ids, sorted by id (canonical node order)
 *  M5  node shape: valid id/processor/version-range; config JSON-safe
 *  M6  dependsOn strictly ascending, valid ids, no self-dependency
 *  M7  consumed artifacts consistent: valid slot names; artifact keys content-address
 *      shaped; every step-output binding references an EXISTING node that is listed in
 *      dependsOn and DECLARES that output (no dangling bindings)
 *  M8  produces non-empty, strictly ascending valid slot names
 *  M9  requires strictly ascending by name, structurally valid
 *  M10 policies valid — REUSING the processing framework's own validators (no duplication)
 *  M11 the dependency graph is acyclic (deterministic ordering exists)
 *
 * Unknown keys are DROPPED (nodes and policies are rebuilt from the known vocabulary), so
 * nothing outside the schema can reach the canonical form or the identity.
 */

const ARTIFACT_KEY_RE = /^[a-z0-9-]+:[0-9a-f]+$/;
const BLUEPRINT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_PROCESSOR = 200;
const MAX_CONFIG_DEPTH = 16;

function bad<T>(
  message: string,
  context?: Record<string, string | number>,
): Result<T, ManifestError> {
  return err(new ManifestError(message, context === undefined ? {} : { context }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Recursively validate + rebuild a JSON-safe value (rejects functions/undefined/NaN/cycles-by-depth). */
function parseJsonValue(
  v: unknown,
  where: string,
  depth: number,
): Result<JsonValue, ManifestError> {
  if (depth > MAX_CONFIG_DEPTH) return bad(`${where}: config nesting too deep`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return ok(v);
  if (typeof v === 'number') {
    return Number.isFinite(v) ? ok(v) : bad(`${where}: config numbers must be finite`);
  }
  if (Array.isArray(v)) {
    const out: JsonValue[] = [];
    for (const item of v) {
      const parsed = parseJsonValue(item, where, depth + 1);
      if (!parsed.ok) return parsed;
      out.push(parsed.value);
    }
    return ok(out);
  }
  if (isRecord(v)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(v)) {
      if (value === undefined) continue;
      const parsed = parseJsonValue(value, where, depth + 1);
      if (!parsed.ok) return parsed;
      out[key] = parsed.value;
    }
    return ok(out);
  }
  return bad(`${where}: config must contain only JSON-safe values`);
}

function parseConfig(v: unknown, where: string): Result<JsonObject, ManifestError> {
  if (v === undefined) return ok({});
  if (!isRecord(v)) return bad(`${where}: config must be an object`);
  const parsed = parseJsonValue(v, where, 0);
  if (!parsed.ok) return parsed;
  return ok(parsed.value as JsonObject);
}

/** Structural narrowing + delegation to the PROCESSING validators (M10 — reuse, not duplication). */
function parseRetry(v: unknown, where: string): Result<RetryPolicy, ManifestError> {
  if (!isRecord(v)) return bad(`${where}: retry policy must be an object`);
  const { maxAttempts, backoff, initialDelayMs, maxDelayMs, multiplier } = v;
  if (backoff !== 'none' && backoff !== 'fixed' && backoff !== 'exponential') {
    return bad(`${where}: retry backoff must be none|fixed|exponential`);
  }
  if (typeof maxAttempts !== 'number' || typeof initialDelayMs !== 'number') {
    return bad(`${where}: retry maxAttempts/initialDelayMs must be numbers`);
  }
  if (maxDelayMs !== undefined && typeof maxDelayMs !== 'number') {
    return bad(`${where}: retry maxDelayMs must be a number`);
  }
  if (multiplier !== undefined && typeof multiplier !== 'number') {
    return bad(`${where}: retry multiplier must be a number`);
  }
  const policy: RetryPolicy = {
    maxAttempts,
    backoff,
    initialDelayMs,
    ...(maxDelayMs === undefined ? {} : { maxDelayMs }),
    ...(multiplier === undefined ? {} : { multiplier }),
  };
  const validated = validateRetryPolicy(policy);
  if (!validated.ok) return bad(`${where}: ${validated.error.message}`);
  return ok(policy);
}

function parseTimeout(v: unknown, where: string): Result<TimeoutPolicy, ManifestError> {
  if (!isRecord(v)) return bad(`${where}: timeout policy must be an object`);
  const { attemptTimeoutMs, overallTimeoutMs } = v;
  if (typeof attemptTimeoutMs !== 'number') {
    return bad(`${where}: timeout attemptTimeoutMs must be a number`);
  }
  if (overallTimeoutMs !== undefined && typeof overallTimeoutMs !== 'number') {
    return bad(`${where}: timeout overallTimeoutMs must be a number`);
  }
  const policy: TimeoutPolicy = {
    attemptTimeoutMs,
    ...(overallTimeoutMs === undefined ? {} : { overallTimeoutMs }),
  };
  const validated = validateTimeoutPolicy(policy);
  if (!validated.ok) return bad(`${where}: ${validated.error.message}`);
  return ok(policy);
}

function parseCancellation(v: unknown, where: string): Result<CancellationPolicy, ManifestError> {
  if (!isRecord(v)) return bad(`${where}: cancellation policy must be an object`);
  const { mode, gracePeriodMs } = v;
  if (mode !== 'unsupported' && mode !== 'cooperative' && mode !== 'abortive') {
    return bad(`${where}: cancellation mode must be unsupported|cooperative|abortive`);
  }
  if (gracePeriodMs !== undefined && typeof gracePeriodMs !== 'number') {
    return bad(`${where}: cancellation gracePeriodMs must be a number`);
  }
  const policy: CancellationPolicy = {
    mode,
    ...(gracePeriodMs === undefined ? {} : { gracePeriodMs }),
  };
  const validated = validateCancellationPolicy(policy);
  if (!validated.ok) return bad(`${where}: ${validated.error.message}`);
  return ok(policy);
}

function parseFailure(v: unknown, where: string): Result<FailurePolicy, ManifestError> {
  if (!isRecord(v)) return bad(`${where}: failure policy must be an object`);
  const policy = {
    onTransient: v.onTransient,
    onTimeout: v.onTimeout,
    onPermanent: v.onPermanent,
  } as FailurePolicy;
  const validated = validateFailurePolicy(policy);
  if (!validated.ok) return bad(`${where}: ${validated.error.message}`);
  return ok(policy);
}

function parseBinding(v: unknown, where: string): Result<ArtifactInputBinding, ManifestError> {
  if (!isRecord(v)) return bad(`${where}: binding must be an object`);
  if (v.kind === 'artifact') {
    if (!isStr(v.key) || !ARTIFACT_KEY_RE.test(v.key)) {
      return bad(`${where}: artifact binding key must be a content address (alg:hexdigest)`);
    }
    return ok({ kind: 'artifact', key: v.key as StorageKey });
  }
  if (v.kind === 'step-output') {
    const producer = isStr(v.stepId) ? makeStepId(v.stepId) : null;
    if (producer === null || !producer.ok) {
      return bad(`${where}: step-output binding has an invalid producer node id`);
    }
    if (!isStr(v.output) || !isValidSlotName(v.output)) {
      return bad(`${where}: step-output binding has an invalid output name`);
    }
    return ok({ kind: 'step-output', stepId: producer.value, output: v.output });
  }
  return bad(`${where}: binding kind must be artifact|step-output`);
}

function parseNode(v: unknown, position: number): Result<WorkNode, ManifestError> {
  if (!isRecord(v)) return bad(`Node at position ${position} must be an object`);
  const rawId = v.id;
  const id = isStr(rawId) ? makeStepId(rawId) : null;
  if (id === null || !id.ok) {
    return bad(`Node at position ${position} has an invalid id`);
  }
  const where = `Node "${id.value}"`;

  // M5 — processor + version range + config.
  if (!isStr(v.processor) || v.processor.trim() === '' || v.processor.length > MAX_PROCESSOR) {
    return bad(`${where}: processor must be a non-empty registry name`);
  }
  if (
    v.processorVersionRange !== undefined &&
    (!isStr(v.processorVersionRange) || v.processorVersionRange.trim() === '')
  ) {
    return bad(`${where}: processorVersionRange must be a non-empty string when present`);
  }
  const config = parseConfig(v.config, where);
  if (!config.ok) return config;

  // M6 — dependsOn strictly ascending, valid, no self.
  if (!Array.isArray(v.dependsOn)) return bad(`${where}: dependsOn must be an array`);
  const dependsOn: StepId[] = [];
  for (const raw of v.dependsOn) {
    const dep = isStr(raw) ? makeStepId(raw) : null;
    if (dep === null || !dep.ok) return bad(`${where}: invalid dependency id`);
    if (dep.value === id.value) return bad(`${where}: node depends on itself`);
    const prev = dependsOn[dependsOn.length - 1];
    if (prev !== undefined && prev >= dep.value) {
      return bad(`${where}: dependsOn must be strictly ascending (unique, canonical order)`);
    }
    dependsOn.push(dep.value);
  }

  // M7 (local half) — consumed bindings.
  if (!isRecord(v.consumes)) return bad(`${where}: consumes must be an object`);
  const consumes: Record<string, ArtifactInputBinding> = {};
  for (const [slot, rawBinding] of Object.entries(v.consumes)) {
    if (!isValidSlotName(slot)) return bad(`${where}: invalid input slot name "${slot}"`);
    const binding = parseBinding(rawBinding, `${where} input "${slot}"`);
    if (!binding.ok) return binding;
    consumes[slot] = binding.value;
  }

  // M8 — produced outputs.
  if (!Array.isArray(v.produces) || v.produces.length === 0) {
    return bad(`${where}: produces must be a non-empty array (work must produce artifacts)`);
  }
  const produces: string[] = [];
  for (const raw of v.produces) {
    if (!isStr(raw) || !isValidSlotName(raw)) {
      return bad(`${where}: invalid output slot name`);
    }
    const prev = produces[produces.length - 1];
    if (prev !== undefined && prev >= raw) {
      return bad(`${where}: produces must be strictly ascending (unique, canonical order)`);
    }
    produces.push(raw);
  }

  // M9 — capability requirements.
  if (!Array.isArray(v.requires)) return bad(`${where}: requires must be an array`);
  const requires: StepCapabilityRequirement[] = [];
  for (const raw of v.requires) {
    if (!isRecord(raw) || !isStr(raw.name)) {
      return bad(`${where}: capability requirement must have a string name`);
    }
    if (raw.versionRange !== undefined && !isStr(raw.versionRange)) {
      return bad(`${where}: capability versionRange must be a string`);
    }
    const req: StepCapabilityRequirement =
      raw.versionRange === undefined
        ? { name: raw.name }
        : { name: raw.name, versionRange: raw.versionRange };
    if (!isValidCapabilityRequirement(req)) {
      return bad(`${where}: capability requirement "${raw.name}" is invalid`);
    }
    const prev = requires[requires.length - 1];
    if (prev !== undefined && prev.name >= req.name) {
      return bad(`${where}: requires must be strictly ascending by name (unique, canonical order)`);
    }
    requires.push(req);
  }

  // M10 — policies (processing validators).
  const retry = parseRetry(v.retry, where);
  if (!retry.ok) return retry;
  const cancellation = parseCancellation(v.cancellation, where);
  if (!cancellation.ok) return cancellation;
  const failure = parseFailure(v.failure, where);
  if (!failure.ok) return failure;
  let timeout: TimeoutPolicy | undefined;
  if (v.timeout !== undefined) {
    const parsed = parseTimeout(v.timeout, where);
    if (!parsed.ok) return parsed;
    timeout = parsed.value;
  }

  const node: WorkNode = {
    id: id.value,
    processor: v.processor,
    ...(v.processorVersionRange === undefined
      ? {}
      : { processorVersionRange: v.processorVersionRange }),
    dependsOn,
    consumes,
    produces,
    requires,
    config: config.value,
    retry: retry.value,
    ...(timeout === undefined ? {} : { timeout }),
    cancellation: cancellation.value,
    failure: failure.value,
  };
  return ok(node);
}

/** The full untrusted-input boundary: parse + every invariant (M1–M11). */
export function validateManifest(input: unknown): Result<Manifest, ManifestError> {
  if (!isRecord(input)) return bad('Manifest must be an object');
  const { schemaVersion, albumId, blueprint, nodes } = input;

  // M1 — schema version.
  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return bad(`Unsupported manifest schema version "${String(schemaVersion)}"`, {
      supported: MANIFEST_SCHEMA_VERSION,
    });
  }
  // M2 — album id.
  if (!isStr(albumId)) return bad('Manifest albumId must be a string');
  const album = makeAlbumId(albumId);
  if (!album.ok) return bad(`Manifest albumId invalid: ${album.error.message}`);
  // M3 — blueprint provenance.
  if (!isStr(blueprint) || !BLUEPRINT_HASH_RE.test(blueprint)) {
    return bad('Manifest blueprint must be a sha256 content address of the source blueprint');
  }

  // M4 + M5..M10 — nodes.
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return bad('Manifest nodes must be a non-empty array');
  }
  const parsed: WorkNode[] = [];
  const byId = new Map<string, WorkNode>();
  for (let i = 0; i < nodes.length; i++) {
    const node = parseNode(nodes[i], i);
    if (!node.ok) return node;
    if (byId.has(node.value.id)) return bad(`Duplicate node id "${node.value.id}"`);
    byId.set(node.value.id, node.value);
    parsed.push(node.value);
  }
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    if (prev !== undefined && curr !== undefined && !(prev.id < curr.id)) {
      return bad(`Nodes must be sorted by id ("${curr.id}" after "${prev.id}")`);
    }
  }

  // M7 (cross-node half) — step-output bindings resolve to declared outputs of dependencies.
  for (const node of parsed) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) {
        return bad(`Node "${node.id}" depends on unknown node "${dep}" (dangling reference)`);
      }
    }
    for (const [slot, binding] of Object.entries(node.consumes)) {
      if (binding.kind !== 'step-output') continue;
      const producer = byId.get(binding.stepId);
      if (producer === undefined) {
        return bad(
          `Node "${node.id}" input "${slot}" references unknown node "${binding.stepId}" (dangling binding)`,
        );
      }
      if (!producer.produces.includes(binding.output)) {
        return bad(
          `Node "${node.id}" input "${slot}" references undeclared output "${binding.output}" of node "${binding.stepId}"`,
        );
      }
      if (!node.dependsOn.includes(binding.stepId)) {
        return bad(
          `Node "${node.id}" consumes output of "${binding.stepId}" but does not declare it in dependsOn`,
        );
      }
    }
  }

  // M11 — the dependency graph must be a DAG (reuses the processing graph validator).
  const graph = orderStepGraph(parsed.map((n) => ({ id: n.id, dependsOn: n.dependsOn })));
  if (!graph.ok) {
    return bad(`Manifest dependency graph invalid: ${graph.error.message}`);
  }

  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    albumId,
    blueprint,
    nodes: parsed,
  };
  return ok(manifest);
}
