import { describe, it, expect } from 'vitest';
import { SupabasePostgresAdapter } from '../src/infra/database/supabase-adapter.js';
import type { SqlClient } from '../src/infra/database/supabase-adapter.js';

/** A fake SqlClient — records calls and returns canned rows, with no database. */
class FakeSql implements SqlClient {
  readonly queries: Array<{ text: string; params: readonly unknown[] }> = [];
  pings = 0;
  ended = false;
  failPing = false;
  rows: readonly unknown[] = [];

  async query<T>(text: string, params: readonly unknown[]): Promise<readonly T[]> {
    this.queries.push({ text, params: [...params] });
    return this.rows as readonly T[];
  }
  async begin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return fn(this); // the fake runs the body against itself (single scope)
  }
  async ping(): Promise<void> {
    this.pings += 1;
    if (this.failPing) throw new Error('connection refused');
  }
  async end(): Promise<void> {
    this.ended = true;
  }
}

describe('SupabasePostgresAdapter', () => {
  it('connect pings once and is idempotent', async () => {
    const sql = new FakeSql();
    const db = new SupabasePostgresAdapter(sql);
    await db.connect();
    await db.connect();
    expect(sql.pings).toBe(1);
  });

  it('query delegates to the SQL client with params', async () => {
    const sql = new FakeSql();
    sql.rows = [{ id: 'p1' }];
    const db = new SupabasePostgresAdapter(sql);

    const rows = await db.query('select id from photos where id = $1', ['p1']);

    expect(rows).toEqual([{ id: 'p1' }]);
    expect(sql.queries).toEqual([{ text: 'select id from photos where id = $1', params: ['p1'] }]);
  });

  it('transaction runs the body against a transaction scope and returns its value', async () => {
    const sql = new FakeSql();
    sql.rows = [{ n: 1 }];
    const db = new SupabasePostgresAdapter(sql);

    const result = await db.transaction(async (tx) => {
      const r = await tx.query('update photos set status = $1', ['ready']);
      return r.length;
    });

    expect(result).toBe(1);
    expect(sql.queries).toEqual([{ text: 'update photos set status = $1', params: ['ready'] }]);
  });

  it('healthCheck reflects connectivity', async () => {
    const sql = new FakeSql();
    const db = new SupabasePostgresAdapter(sql);
    expect(await db.healthCheck()).toBe('healthy');
    sql.failPing = true;
    expect(await db.healthCheck()).toBe('unhealthy');
  });

  it('close ends the pool only when connected', async () => {
    const sql = new FakeSql();
    const db = new SupabasePostgresAdapter(sql);
    await db.close();
    expect(sql.ended).toBe(false); // never connected → nothing to close
    await db.connect();
    await db.close();
    expect(sql.ended).toBe(true);
  });
});
