import type { Result, JsonObject } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import {
  Album,
  Asset,
  Run,
  VersionSet,
  recordTransition,
  makeAlbumId,
  makeAssetId,
  makeRunId,
  makeAuditId,
  makeActorId,
  makeTimestamp,
  makeActor,
} from '@workerv2/control-plane';
import type { AuditRecord, ActorKind, EntityType } from '@workerv2/control-plane';
import type { AlbumRecord, AssetRecord, RunRecord, AuditRecordDto } from './dto.js';

/**
 * The bidirectional mapping contract between a domain object and its persistence record — the
 * ANTI-CORRUPTION LAYER. `toRecord` serializes a domain object for storage; `toDomain`
 * reconstitutes a domain object from a record (validating on the way in, delegating construction
 * to the domain's `reconstitute`). Repositories return DOMAIN objects via a mapper — they never
 * expose persistence models, and they cannot bypass aggregate invariants.
 */
export interface RecordMapper<TDomain, TRecord> {
  toRecord(domain: TDomain): TRecord;
  toDomain(record: TRecord): Result<TDomain, ValidationError>;
}

export type AlbumRecordMapper = RecordMapper<Album, AlbumRecord>;
export type AssetRecordMapper = RecordMapper<Asset, AssetRecord>;
export type RunRecordMapper = RecordMapper<Run, RunRecord>;
export type AuditRecordMapper = RecordMapper<AuditRecord, AuditRecordDto>;

// --- Concrete outbound mappers (domain → persistence). Pure, deterministic, no I/O. ---

export function albumToRecord(album: Album): AlbumRecord {
  return {
    id: album.id,
    title: album.title,
    status: album.status,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
  };
}

export function assetToRecord(asset: Asset): AssetRecord {
  return {
    id: asset.id,
    albumId: asset.albumId,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function runToRecord(run: Run): RunRecord {
  return {
    id: run.id,
    albumId: run.albumId,
    status: run.status,
    versions: run.versions.toJSON(),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function auditToRecord(record: AuditRecord): AuditRecordDto {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    actorId: record.actor.id,
    actorKind: record.actor.kind,
    entityType: record.entityType,
    entityId: record.entityId,
    action: record.action,
    ...(record.fromState !== undefined ? { fromState: record.fromState } : {}),
    ...(record.toState !== undefined ? { toState: record.toState } : {}),
    ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
  };
}

// --- Concrete inbound mappers (persistence → domain). Parse value objects, then delegate
// construction to the domain's reconstitution API (invariants stay in the domain). ---

export function recordToAlbum(record: AlbumRecord): Result<Album, ValidationError> {
  const id = makeAlbumId(record.id);
  if (!id.ok) return id;
  const createdAt = makeTimestamp(record.createdAt);
  if (!createdAt.ok) return createdAt;
  const updatedAt = makeTimestamp(record.updatedAt);
  if (!updatedAt.ok) return updatedAt;
  return Album.reconstitute({
    id: id.value,
    title: record.title,
    status: record.status,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  });
}

export function recordToAsset(record: AssetRecord): Result<Asset, ValidationError> {
  const id = makeAssetId(record.id);
  if (!id.ok) return id;
  const albumId = makeAlbumId(record.albumId);
  if (!albumId.ok) return albumId;
  const createdAt = makeTimestamp(record.createdAt);
  if (!createdAt.ok) return createdAt;
  const updatedAt = makeTimestamp(record.updatedAt);
  if (!updatedAt.ok) return updatedAt;
  return Asset.reconstitute({
    id: id.value,
    albumId: albumId.value,
    status: record.status,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  });
}

export function recordToRun(record: RunRecord): Result<Run, ValidationError> {
  const id = makeRunId(record.id);
  if (!id.ok) return id;
  const albumId = makeAlbumId(record.albumId);
  if (!albumId.ok) return albumId;
  const versions = VersionSet.create(record.versions);
  if (!versions.ok) return versions;
  const createdAt = makeTimestamp(record.createdAt);
  if (!createdAt.ok) return createdAt;
  const updatedAt = makeTimestamp(record.updatedAt);
  if (!updatedAt.ok) return updatedAt;
  return Run.reconstitute({
    id: id.value,
    albumId: albumId.value,
    status: record.status,
    versions: versions.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  });
}

const ACTOR_KINDS: readonly string[] = ['customer', 'admin', 'system'];
const ENTITY_TYPES: readonly string[] = ['album', 'asset', 'run'];

export function recordToAudit(record: AuditRecordDto): Result<AuditRecord, ValidationError> {
  const id = makeAuditId(record.id);
  if (!id.ok) return id;
  const actorId = makeActorId(record.actorId);
  if (!actorId.ok) return actorId;
  const occurredAt = makeTimestamp(record.occurredAt);
  if (!occurredAt.ok) return occurredAt;
  if (!ACTOR_KINDS.includes(record.actorKind)) {
    return err(new ValidationError(`Unknown actor kind: "${record.actorKind}"`));
  }
  if (!ENTITY_TYPES.includes(record.entityType)) {
    return err(new ValidationError(`Unknown entity type: "${record.entityType}"`));
  }
  return ok(
    recordTransition({
      id: id.value,
      occurredAt: occurredAt.value,
      actor: makeActor(actorId.value, record.actorKind as ActorKind),
      entityType: record.entityType as EntityType,
      entityId: record.entityId,
      action: record.action,
      ...(record.fromState !== undefined ? { fromState: record.fromState } : {}),
      ...(record.toState !== undefined ? { toState: record.toState } : {}),
      ...(record.metadata !== undefined ? { metadata: record.metadata as JsonObject } : {}),
    }),
  );
}

// --- Ready-made mapper objects implementing the full bidirectional contract. ---

export const albumMapper: AlbumRecordMapper = { toRecord: albumToRecord, toDomain: recordToAlbum };
export const assetMapper: AssetRecordMapper = { toRecord: assetToRecord, toDomain: recordToAsset };
export const runMapper: RunRecordMapper = { toRecord: runToRecord, toDomain: recordToRun };
export const auditMapper: AuditRecordMapper = { toRecord: auditToRecord, toDomain: recordToAudit };
