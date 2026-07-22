import type { Result } from '@workerv2/contracts';
import { valid, invalid } from '@workerv2/infra-contracts';
import type { Validator, AlbumRecord, AssetRecord, RunRecord } from '@workerv2/infra-contracts';
import type { ValidationError } from '@workerv2/errors';

/**
 * Infrastructure VALIDATION — parse untrusted `unknown` (e.g. a raw database row) into a typed
 * persistence DTO before it is mapped to the domain. This is the first defensive boundary a
 * concrete adapter applies; the reference engine stores typed DTOs, but a durable engine reading
 * loose rows would run these first. Shape checks only — no domain rules (those stay in the domain).
 */
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

export function validateAlbumRecord(input: unknown): Result<AlbumRecord, ValidationError> {
  if (!isRecord(input)) return invalid('Album record must be an object');
  const { id, title, status, createdAt, updatedAt } = input;
  if (!isStr(id) || !isStr(title) || !isStr(status) || !isStr(createdAt) || !isStr(updatedAt)) {
    return invalid('Album record has missing/invalid string fields', {
      fields: 'id,title,status,createdAt,updatedAt',
    });
  }
  return valid({ id, title, status, createdAt, updatedAt });
}

export function validateAssetRecord(input: unknown): Result<AssetRecord, ValidationError> {
  if (!isRecord(input)) return invalid('Asset record must be an object');
  const { id, albumId, status, createdAt, updatedAt } = input;
  if (!isStr(id) || !isStr(albumId) || !isStr(status) || !isStr(createdAt) || !isStr(updatedAt)) {
    return invalid('Asset record has missing/invalid string fields');
  }
  return valid({ id, albumId, status, createdAt, updatedAt });
}

export function validateRunRecord(input: unknown): Result<RunRecord, ValidationError> {
  if (!isRecord(input)) return invalid('Run record must be an object');
  const { id, albumId, status, versions, createdAt, updatedAt } = input;
  if (!isStr(id) || !isStr(albumId) || !isStr(status) || !isStr(createdAt) || !isStr(updatedAt)) {
    return invalid('Run record has missing/invalid string fields');
  }
  if (!isRecord(versions)) return invalid('Run record versions must be an object');
  const pins: Record<string, string> = {};
  for (const [component, version] of Object.entries(versions)) {
    if (!isStr(version)) return invalid(`Run record version for "${component}" must be a string`);
    pins[component] = version;
  }
  return valid({ id, albumId, status, versions: pins, createdAt, updatedAt });
}

export const albumRecordValidator: Validator<AlbumRecord> = { validate: validateAlbumRecord };
export const assetRecordValidator: Validator<AssetRecord> = { validate: validateAssetRecord };
export const runRecordValidator: Validator<RunRecord> = { validate: validateRunRecord };
