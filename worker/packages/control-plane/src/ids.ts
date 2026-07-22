import type { Brand, Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';

/**
 * Branded identifier value objects. Identifiers are INPUTS to the domain — the domain never
 * generates them (id generation is infrastructure, deferred). Constructors validate shape
 * only; they are pure and deterministic.
 */
export type AlbumId = Brand<string, 'AlbumId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type RunId = Brand<string, 'RunId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type EventId = Brand<string, 'EventId'>;
export type AuditId = Brand<string, 'AuditId'>;

const MAX_ID_LENGTH = 200;

function validateId(raw: string, label: string): Result<string, ValidationError> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return err(new ValidationError(`${label} must be a non-empty string`, { context: { label } }));
  }
  if (trimmed.length > MAX_ID_LENGTH) {
    return err(
      new ValidationError(`${label} exceeds ${MAX_ID_LENGTH} characters`, {
        context: { label, length: trimmed.length },
      }),
    );
  }
  return ok(trimmed);
}

function idFactory<B extends string>(label: string) {
  return (raw: string): Result<Brand<string, B>, ValidationError> => {
    const r = validateId(raw, label);
    return r.ok ? ok(r.value as Brand<string, B>) : r;
  };
}

export const makeAlbumId = idFactory<'AlbumId'>('AlbumId');
export const makeAssetId = idFactory<'AssetId'>('AssetId');
export const makeRunId = idFactory<'RunId'>('RunId');
export const makeActorId = idFactory<'ActorId'>('ActorId');
export const makeEventId = idFactory<'EventId'>('EventId');
export const makeAuditId = idFactory<'AuditId'>('AuditId');
