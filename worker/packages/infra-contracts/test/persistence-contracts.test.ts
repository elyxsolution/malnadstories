import { describe, expect, it } from 'vitest';
import { ALBUM_REPOSITORY, repositoryToken } from '@workerv2/infra-contracts';
import type {
  AlbumRepository,
  Repository,
  RepositoryToken,
  UnitOfWork,
  TransactionManager,
} from '@workerv2/infra-contracts';
import type { Album, AlbumId } from '@workerv2/control-plane';
import { sampleAlbum } from './helpers.js';

// --- In-memory TEST DOUBLES implementing the contracts (not production code) ---

class InMemoryAlbumRepository implements AlbumRepository {
  private readonly store = new Map<string, Album>();
  async findById(id: AlbumId): Promise<Album | null> {
    return this.store.get(id) ?? null;
  }
  async exists(id: AlbumId): Promise<boolean> {
    return this.store.has(id);
  }
  async save(aggregate: Album): Promise<void> {
    this.store.set(aggregate.id, aggregate);
  }
  async delete(id: AlbumId): Promise<void> {
    this.store.delete(id);
  }
}

class FakeUnitOfWork implements UnitOfWork {
  active = true;
  committed = false;
  rolledBack = false;
  private readonly repos = new Map<string, unknown>();
  constructor(entries: ReadonlyArray<[RepositoryToken<unknown, unknown>, unknown]>) {
    for (const [token, repo] of entries) this.repos.set(token.name, repo);
  }
  get<TAggregate, TId>(token: RepositoryToken<TAggregate, TId>): Repository<TAggregate, TId> {
    const repo = this.repos.get(token.name);
    if (repo === undefined) throw new Error(`No repository for "${token.name}"`);
    return repo as Repository<TAggregate, TId>;
  }
  async commit(): Promise<void> {
    this.active = false;
    this.committed = true;
  }
  async rollback(): Promise<void> {
    this.active = false;
    this.rolledBack = true;
  }
}

class FakeTransactionManager implements TransactionManager {
  constructor(private readonly uow: FakeUnitOfWork) {}
  async withUnitOfWork<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    try {
      const result = await work(this.uow);
      await this.uow.commit();
      return result;
    } catch (error) {
      await this.uow.rollback();
      throw error;
    }
  }
}

describe('repository contract', () => {
  it('round-trips a DOMAIN object (never a DTO)', async () => {
    const repo: AlbumRepository = new InMemoryAlbumRepository();
    const album = sampleAlbum();
    expect(await repo.exists(album.id)).toBe(false);
    await repo.save(album);
    const loaded = await repo.findById(album.id);
    expect(loaded).toBe(album); // same domain aggregate instance
    expect(loaded?.status).toBe('draft');
    await repo.delete(album.id);
    expect(await repo.exists(album.id)).toBe(false);
  });
});

describe('repository factory / unit of work', () => {
  it('resolves repositories generically by token', () => {
    const repo = new InMemoryAlbumRepository();
    const uow = new FakeUnitOfWork([[ALBUM_REPOSITORY, repo]]);
    expect(uow.get(ALBUM_REPOSITORY)).toBe(repo);
    expect(() => uow.get(repositoryToken('missing'))).toThrowError(/No repository/);
  });
});

describe('transaction manager', () => {
  it('commits on success', async () => {
    const uow = new FakeUnitOfWork([[ALBUM_REPOSITORY, new InMemoryAlbumRepository()]]);
    const tm = new FakeTransactionManager(uow);
    const out = await tm.withUnitOfWork(async (u) => {
      await u.get(ALBUM_REPOSITORY).save(sampleAlbum());
      return 'done';
    });
    expect(out).toBe('done');
    expect(uow.committed).toBe(true);
    expect(uow.active).toBe(false);
  });

  it('rolls back when the work throws', async () => {
    const uow = new FakeUnitOfWork([[ALBUM_REPOSITORY, new InMemoryAlbumRepository()]]);
    const tm = new FakeTransactionManager(uow);
    await expect(
      tm.withUnitOfWork(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrowError(/boom/);
    expect(uow.rolledBack).toBe(true);
    expect(uow.committed).toBe(false);
  });
});
