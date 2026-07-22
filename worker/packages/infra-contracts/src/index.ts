// @workerv2/infra-contracts — the abstraction layer between the pure domain and future
// infrastructure. Contracts (interfaces) + persistence DTOs + concrete OUTBOUND mappers +
// infra technical events. NO concrete storage/DB/queue implementations, no business logic.

// --- Errors ---
export { PersistenceError, StorageError, MappingError, IntegrityError } from './errors.js';

// --- Validation contracts ---
export type { Validator } from './validation/validator.js';
export { valid, invalid } from './validation/validator.js';

// --- Persistence: DTOs ---
export type { AlbumRecord, AssetRecord, RunRecord, AuditRecordDto } from './persistence/dto.js';

// --- Persistence: mappers (anti-corruption layer) ---
export type {
  RecordMapper,
  AlbumRecordMapper,
  AssetRecordMapper,
  RunRecordMapper,
  AuditRecordMapper,
} from './persistence/mapper.js';
export { albumToRecord, assetToRecord, runToRecord, auditToRecord } from './persistence/mapper.js';
export { recordToAlbum, recordToAsset, recordToRun, recordToAudit } from './persistence/mapper.js';
export { albumMapper, assetMapper, runMapper, auditMapper } from './persistence/mapper.js';

// --- Persistence: repositories ---
export type {
  Repository,
  AlbumRepository,
  AssetRepository,
  RunRepository,
  RunStateQuery,
  AuditSink,
} from './persistence/repository.js';

// --- Persistence: repository factory ---
export type {
  RepositoryToken,
  RepositoryFactory,
  RepositoryName,
} from './persistence/repository-factory.js';
export { repositoryToken } from './persistence/repository-factory.js';

// --- Persistence: unit of work + transactions ---
export type { Transaction, UnitOfWork, TransactionManager } from './persistence/unit-of-work.js';

// --- Persistence: adapter seam + well-known tokens ---
export type { PersistenceAdapter } from './persistence/adapter.js';
export { ALBUM_REPOSITORY, ASSET_REPOSITORY, RUN_REPOSITORY } from './persistence/adapter.js';

// --- Storage contracts ---
export type {
  StorageKey,
  ContentAddressing,
  StoredArtifact,
  ArtifactStore,
  StorageAdapter,
} from './storage/artifact-store.js';

// --- Storage contracts: streaming, provenance, registry, integrity (byte-level artifact platform) ---
export type { ArtifactByteStream, StreamingArtifactStore } from './storage/streaming.js';
export type { ArtifactKind, ArtifactProvenance, ArtifactDescriptor } from './storage/provenance.js';
export { ARTIFACT_KINDS } from './storage/provenance.js';
export type { ArtifactRegistry } from './storage/registry.js';
export type { IntegrityVerifier } from './storage/integrity.js';

// --- Infrastructure technical events (INV-12) ---
export type { InfraEventType, TechnicalEventSink } from './events/infra-events.js';
export { INFRA_EVENTS, makeInfraEvent } from './events/infra-events.js';
