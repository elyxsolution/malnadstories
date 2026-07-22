import {
  ALBUM_REPOSITORY,
  ASSET_REPOSITORY,
  RUN_REPOSITORY,
  StorageError,
  auditToRecord,
} from '@workerv2/infra-contracts';
import type {
  UnitOfWork,
  Repository,
  RepositoryToken,
  AuditSink,
  StoredArtifact,
  AlbumRecord,
  AssetRecord,
  RunRecord,
  AuditRecordDto,
} from '@workerv2/infra-contracts';
import { PolicyViolationError } from '@workerv2/control-plane';
import type { AuditRecord } from '@workerv2/control-plane';
import type { Database } from './store/database.js';
import { TableTransaction } from './store/table-transaction.js';
import {
  TransactionalAlbumRepository,
  TransactionalAssetRepository,
  TransactionalRunRepository,
} from './repositories.js';

interface ActiveRunOp {
  readonly albumId: string;
  readonly runId: string;
}

/**
 * The in-memory Unit of Work. Repositories, audit, the run-registry index, and artifact metadata
 * all stage their changes here; `commit` validates every table's optimistic locks + the INV-6 and
 * write-once guards, then applies EVERYTHING atomically (all-or-nothing). `rollback` discards.
 * Implements the generic `UnitOfWork` contract and exposes engine extras (audit, active-run,
 * artifact metadata) that participate in the same transaction.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  active = true;

  private readonly albumsTx: TableTransaction<AlbumRecord>;
  private readonly assetsTx: TableTransaction<AssetRecord>;
  private readonly runsTx: TableTransaction<RunRecord>;
  private readonly albumRepo: TransactionalAlbumRepository;
  private readonly assetRepo: TransactionalAssetRepository;
  private readonly runRepo: TransactionalRunRepository;

  private readonly stagedAudit: AuditRecordDto[] = [];
  private readonly reserves: ActiveRunOp[] = [];
  private readonly releases: ActiveRunOp[] = [];
  private readonly artifactPuts: StoredArtifact[] = [];

  constructor(private readonly db: Database) {
    this.albumsTx = new TableTransaction(db.albums, 'album');
    this.assetsTx = new TableTransaction(db.assets, 'asset');
    this.runsTx = new TableTransaction(db.runs, 'run');
    this.albumRepo = new TransactionalAlbumRepository(this.albumsTx);
    this.assetRepo = new TransactionalAssetRepository(this.assetsTx);
    this.runRepo = new TransactionalRunRepository(this.runsTx);
  }

  get<TAggregate, TId>(token: RepositoryToken<TAggregate, TId>): Repository<TAggregate, TId> {
    let repo: unknown;
    switch (token.name) {
      case ALBUM_REPOSITORY.name:
        repo = this.albumRepo;
        break;
      case ASSET_REPOSITORY.name:
        repo = this.assetRepo;
        break;
      case RUN_REPOSITORY.name:
        repo = this.runRepo;
        break;
      default:
        throw new Error(`No repository registered for token "${token.name}"`);
    }
    return repo as Repository<TAggregate, TId>;
  }

  /** Append-only audit sink participating in this transaction (INV-9). */
  get audit(): AuditSink {
    return {
      append: async (record: AuditRecord): Promise<void> => {
        this.stagedAudit.push(auditToRecord(record));
      },
    };
  }

  /** Run records for an album within this transaction (read side of the run registry). */
  runsForAlbum(albumId: string): RunRecord[] {
    return this.runRepo.recordsForAlbum(albumId);
  }

  reserveActiveRun(albumId: string, runId: string): void {
    this.reserves.push({ albumId, runId });
  }
  releaseActiveRun(albumId: string, runId: string): void {
    this.releases.push({ albumId, runId });
  }

  /** Stage write-once artifact metadata (INV-2 / INV-10). */
  putArtifactMetadata(metadata: StoredArtifact): void {
    this.artifactPuts.push(metadata);
  }

  async commit(): Promise<void> {
    if (!this.active) throw new Error('Unit of work is no longer active');

    // Validate everything BEFORE applying anything (atomicity).
    this.albumsTx.validate();
    this.assetsTx.validate();
    this.runsTx.validate();
    for (const op of this.reserves) {
      if (this.db.activeRuns.has(op.albumId)) {
        throw new PolicyViolationError('An active run already exists for this album (INV-6)', {
          context: { albumId: op.albumId },
        });
      }
    }
    for (const meta of this.artifactPuts) {
      if (this.db.artifacts.has(meta.key)) {
        throw new StorageError(`Refusing to overwrite artifact metadata: ${meta.key}`, {
          context: { key: meta.key },
        });
      }
    }

    // Apply atomically.
    this.albumsTx.apply();
    this.assetsTx.apply();
    this.runsTx.apply();
    for (const record of this.stagedAudit) this.db.audit.push(record);
    for (const op of this.reserves) this.db.activeRuns.set(op.albumId, op.runId);
    for (const op of this.releases) {
      if (this.db.activeRuns.get(op.albumId) === op.runId) this.db.activeRuns.delete(op.albumId);
    }
    for (const meta of this.artifactPuts) this.db.artifacts.set(meta.key, meta);

    this.active = false;
  }

  async rollback(): Promise<void> {
    this.active = false;
  }
}
