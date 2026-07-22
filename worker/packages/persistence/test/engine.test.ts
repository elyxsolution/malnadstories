import { describe, expect, it } from 'vitest';
import {
  StateStore,
  Database,
  InMemoryUnitOfWork,
  InMemoryRecordTable,
  TableTransaction,
  TransactionalAlbumRepository,
  ConcurrencyError,
} from '@workerv2/persistence';
import { ALBUM_REPOSITORY, PersistenceError } from '@workerv2/infra-contracts';
import type { AlbumRecord } from '@workerv2/infra-contracts';
import type { AlbumId } from '@workerv2/control-plane';
import { newAlbum } from './helpers.js';

describe('StateStore — save / load through the Unit of Work', () => {
  it('persists and reconstitutes a DOMAIN aggregate across transactions', async () => {
    const store = new StateStore();
    const album = newAlbum();
    await store.transaction(async (uow) => {
      await uow.get(ALBUM_REPOSITORY).save(album);
    });
    const loaded = await store.transaction(async (uow) =>
      uow.get(ALBUM_REPOSITORY).findById(album.id),
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(album.id);
    expect(loaded?.status).toBe('draft');
    expect(loaded?.title).toBe('Goa');
    // It is a real domain aggregate (immutable), not a DTO.
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it('rolls back all writes when the work throws', async () => {
    const store = new StateStore();
    const album = newAlbum();
    await expect(
      store.transaction(async (uow) => {
        await uow.get(ALBUM_REPOSITORY).save(album);
        throw new Error('boom');
      }),
    ).rejects.toThrowError(/boom/);
    const after = await store.transaction(async (uow) =>
      uow.get(ALBUM_REPOSITORY).findById(album.id),
    );
    expect(after).toBeNull();
  });
});

describe('optimistic concurrency', () => {
  it('rejects a stale update (lost-update prevention)', async () => {
    const db = new Database();
    const album = newAlbum();

    const seed = new InMemoryUnitOfWork(db);
    await seed.get(ALBUM_REPOSITORY).save(album);
    await seed.commit();

    // Two transactions load the same version.
    const uow1 = new InMemoryUnitOfWork(db);
    const uow2 = new InMemoryUnitOfWork(db);
    const a1 = await uow1.get(ALBUM_REPOSITORY).findById(album.id);
    const a2 = await uow2.get(ALBUM_REPOSITORY).findById(album.id);
    if (a1 === null || a2 === null) throw new Error('expected album');

    await uow1.get(ALBUM_REPOSITORY).save(a1);
    await uow1.commit(); // bumps version

    await uow2.get(ALBUM_REPOSITORY).save(a2);
    await expect(uow2.commit()).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('rejects an insert that collides with an existing id', async () => {
    const store = new StateStore();
    const album = newAlbum();
    await store.transaction(async (uow) => uow.get(ALBUM_REPOSITORY).save(album));
    // A fresh insert (never loaded) of the same id must conflict.
    await expect(
      store.transaction(async (uow) => uow.get(ALBUM_REPOSITORY).save(newAlbum('alb-1', 'Other'))),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe('repositories cannot bypass aggregate invariants', () => {
  it('surfaces a corrupt record as a PersistenceError, never a bad aggregate', async () => {
    const table = new InMemoryRecordTable<AlbumRecord>();
    table.set('alb-x', {
      version: 1,
      record: {
        id: 'alb-x',
        title: 'X',
        status: 'not-a-real-status',
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      },
    });
    const repo = new TransactionalAlbumRepository(new TableTransaction(table, 'album'));
    await expect(repo.findById('alb-x' as AlbumId)).rejects.toBeInstanceOf(PersistenceError);
  });
});
