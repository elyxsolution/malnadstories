import type {
  PersistenceAdapter,
  UnitOfWork,
  StoredArtifact,
  StorageKey,
  AuditRecordDto,
} from '@workerv2/infra-contracts';
import type { AlbumId } from '@workerv2/control-plane';
import { Database } from './store/database.js';
import { InMemoryUnitOfWork } from './unit-of-work.js';
import { RunRegistry } from './run-registry.js';

/**
 * The State Store — the concrete persistence engine that owns the in-memory database and hands out
 * transactions. `transaction()` runs work inside a full engine Unit of Work (repositories + audit +
 * run registry + artifact metadata), committing on success and rolling back on throw. It also
 * exposes the generic Phase-3 `PersistenceAdapter` for contract-only consumers, plus read-side
 * queries. It holds NO business logic — only persistence orchestration.
 */
export class StateStore {
  private readonly db = new Database();
  readonly runRegistry: RunRegistry;

  constructor() {
    this.runRegistry = new RunRegistry(this.db);
  }

  /** Run work in a full engine Unit of Work; commit on success, rollback on throw. */
  async transaction<T>(work: (uow: InMemoryUnitOfWork) => Promise<T>): Promise<T> {
    const uow = new InMemoryUnitOfWork(this.db);
    try {
      const result = await work(uow);
      await uow.commit();
      return result;
    } catch (error) {
      await uow.rollback();
      throw error;
    }
  }

  /** The generic Phase-3 persistence seam (repositories + run-state query, no engine extras). */
  asPersistenceAdapter(): PersistenceAdapter {
    return {
      transactions: {
        withUnitOfWork: <T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> =>
          this.transaction((uow) => work(uow)),
      },
      runStateQuery: {
        runStatesForAlbum: (albumId: AlbumId): Promise<string[]> => this.runStatesForAlbum(albumId),
      },
    };
  }

  /** Statuses of all runs for an album (committed state). */
  async runStatesForAlbum(albumId: AlbumId): Promise<string[]> {
    return this.db.runs
      .entries()
      .map(([, versioned]) => versioned.record)
      .filter((record) => record.albumId === albumId)
      .map((record) => record.status);
  }

  /** The append-only audit log (committed). */
  auditLog(): readonly AuditRecordDto[] {
    return [...this.db.audit];
  }

  /** Committed artifact metadata for a key, or null. */
  artifactMetadata(key: StorageKey): StoredArtifact | null {
    return this.db.artifacts.get(key) ?? null;
  }
}
