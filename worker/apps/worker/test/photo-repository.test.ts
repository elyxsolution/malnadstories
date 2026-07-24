import { describe, it, expect } from 'vitest';
import type {
  DatabaseAdapter,
  DatabaseTransaction,
} from '../src/infra/database/database-adapter.js';
import { PhotoRepository } from '../src/processors/image/photo-repository.js';

/** A DatabaseAdapter that records the SQL + params and returns canned rows — no database. */
class RecordingDb implements DatabaseAdapter {
  readonly calls: Array<{ text: string; params: readonly unknown[] }> = [];
  rows: readonly unknown[] = [];

  async connect(): Promise<void> {}
  async query<T>(text: string, params?: readonly unknown[]): Promise<readonly T[]> {
    this.calls.push({ text, params: params ?? [] });
    return this.rows as readonly T[];
  }
  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return fn({ query: (t, p) => this.query(t, p) });
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
  async close(): Promise<void> {}
}

describe('PhotoRepository', () => {
  it('findById maps snake_case columns to a PhotoRow, or null', async () => {
    const db = new RecordingDb();
    db.rows = [
      {
        id: 'p1',
        user_id: 'u1',
        album_id: 'a1',
        r2_key: 'u1/albums/a1/x.jpg',
        status: 'pending',
        original_filename: 'x.jpg',
      },
    ];
    const repo = new PhotoRepository(db);

    expect(await repo.findById('p1')).toEqual({
      id: 'p1',
      userId: 'u1',
      albumId: 'a1',
      rawKey: 'u1/albums/a1/x.jpg',
      status: 'pending',
      originalFilename: 'x.jpg',
    });
    expect(db.calls[0]?.params).toEqual(['p1']);

    db.rows = [];
    expect(await repo.findById('missing')).toBeNull();
  });

  it('markReady issues a parameterized ready-update keeping r2_key', async () => {
    const db = new RecordingDb();
    const takenAt = new Date('2024-01-02T03:04:05.000Z');
    await new PhotoRepository(db).markReady('p1', {
      sanitizedKey: 's.jpg',
      thumbKey: 't.jpg',
      width: 100,
      height: 80,
      takenAt,
    });
    const call = db.calls[0]!;
    expect(call.text).toContain("status = 'ready'");
    expect(call.text).not.toContain('r2_key'); // raw key deliberately preserved
    expect(call.params).toEqual(['p1', 's.jpg', 't.jpg', 100, 80, takenAt]);
  });

  it('markRejected and clearRawKey are parameterized single-row updates', async () => {
    const db = new RecordingDb();
    const repo = new PhotoRepository(db);
    await repo.markRejected('p1');
    await repo.clearRawKey('p1');
    expect(db.calls[0]?.text).toContain("status = 'rejected'");
    expect(db.calls[0]?.params).toEqual(['p1']);
    expect(db.calls[1]?.text).toContain('r2_key = null');
    expect(db.calls[1]?.params).toEqual(['p1']);
  });
});
