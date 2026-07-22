import type { Result } from '@workerv2/contracts';
import { valid, invalid, ARTIFACT_KINDS } from '@workerv2/infra-contracts';
import type {
  ArtifactDescriptor,
  ArtifactKind,
  ArtifactProvenance,
  StorageKey,
  Validator,
} from '@workerv2/infra-contracts';
import { makeAssetId, makeRunId, makeTimestamp } from '@workerv2/control-plane';
import type { ValidationError } from '@workerv2/errors';
import { CONTENT_HASH_ALGORITHM } from './content-addressing.js';

/**
 * ARTIFACT VALIDATION — parse an untrusted `unknown` (e.g. a raw registry row from a durable
 * backend) into a typed, internally-consistent `ArtifactDescriptor` before it is trusted.
 * Shape + consistency checks only (key ⇄ algorithm/digest agreement, hex digest, known kind,
 * value-object shapes) — no business rules.
 */
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

const HEX_RE = /^[0-9a-f]+$/;

function isArtifactKind(value: unknown): value is ArtifactKind {
  return isStr(value) && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

function validateProvenance(input: unknown): Result<ArtifactProvenance, ValidationError> {
  if (!isRecord(input)) return invalid('Artifact provenance must be an object');
  const { runId, step, kind, versions, sourceAssetIds, createdAt } = input;

  if (!isStr(runId)) return invalid('Artifact provenance runId must be a string');
  const parsedRunId = makeRunId(runId);
  if (!parsedRunId.ok) return parsedRunId;

  if (!isStr(step) || step.trim() === '') {
    return invalid('Artifact provenance step must be a non-empty string');
  }
  if (!isArtifactKind(kind)) {
    return invalid('Artifact provenance kind is not a known artifact kind', {
      kinds: ARTIFACT_KINDS.join(','),
    });
  }
  if (!isRecord(versions)) return invalid('Artifact provenance versions must be an object');
  const pins: Record<string, string> = {};
  for (const [component, version] of Object.entries(versions)) {
    if (!isStr(version)) {
      return invalid(`Artifact provenance version for "${component}" must be a string`);
    }
    pins[component] = version;
  }
  if (!Array.isArray(sourceAssetIds)) {
    return invalid('Artifact provenance sourceAssetIds must be an array');
  }
  const assetIds = [];
  for (const raw of sourceAssetIds) {
    if (!isStr(raw)) return invalid('Artifact provenance sourceAssetIds must contain strings');
    const parsed = makeAssetId(raw);
    if (!parsed.ok) return parsed;
    assetIds.push(parsed.value);
  }
  if (!isStr(createdAt)) return invalid('Artifact provenance createdAt must be a string');
  const parsedCreatedAt = makeTimestamp(createdAt);
  if (!parsedCreatedAt.ok) return parsedCreatedAt;

  return valid({
    runId: parsedRunId.value,
    step: step.trim(),
    kind,
    versions: pins,
    sourceAssetIds: assetIds,
    createdAt: parsedCreatedAt.value,
  });
}

export function validateArtifactDescriptor(
  input: unknown,
): Result<ArtifactDescriptor, ValidationError> {
  if (!isRecord(input)) return invalid('Artifact descriptor must be an object');
  const { key, algorithm, digest, sizeBytes, contentType, provenance } = input;

  if (!isStr(key) || !isStr(algorithm) || !isStr(digest)) {
    return invalid('Artifact descriptor has missing/invalid string fields', {
      fields: 'key,algorithm,digest',
    });
  }
  if (algorithm !== CONTENT_HASH_ALGORITHM) {
    return invalid(`Artifact descriptor algorithm must be "${CONTENT_HASH_ALGORITHM}"`, {
      algorithm,
    });
  }
  if (!HEX_RE.test(digest)) {
    return invalid('Artifact descriptor digest must be lower-case hex');
  }
  if (key !== `${algorithm}:${digest}`) {
    return invalid('Artifact descriptor key does not match its algorithm:digest', { key });
  }
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return invalid('Artifact descriptor sizeBytes must be a non-negative integer');
  }
  if (contentType !== undefined && !isStr(contentType)) {
    return invalid('Artifact descriptor contentType must be a string when present');
  }
  const parsedProvenance = validateProvenance(provenance);
  if (!parsedProvenance.ok) return parsedProvenance;

  const base = {
    key: key as StorageKey,
    algorithm,
    digest,
    sizeBytes,
    provenance: parsedProvenance.value,
  };
  return valid(contentType === undefined ? base : { ...base, contentType });
}

export const artifactDescriptorValidator: Validator<ArtifactDescriptor> = {
  validate: validateArtifactDescriptor,
};
