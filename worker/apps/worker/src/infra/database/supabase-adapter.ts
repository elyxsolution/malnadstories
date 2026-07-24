import postgres from 'postgres';
import type { DatabaseInfraConfig } from '../config.js';
import type { DatabaseAdapter, DatabaseHealth, DatabaseTransaction } from './database-adapter.js';

/**
 * SUPABASE POSTGRES ADAPTER — the production `DatabaseAdapter` over Supabase Postgres using postgres.js
 * (the same driver Drizzle uses in the app), connected over the DIRECT (session) connection so real
 * transactions work. It performs NO business logic: it is a thin, faithful wrapper over `query`,
 * `transaction`, `healthCheck`, and pool lifecycle.
 *
 * The adapter depends on a minimal structural `SqlClient` port so it is unit tested with a fake — no
 * database. `fromConfig` builds the real postgres.js-backed client. This phase only PREPARES the
 * adapter; no query is ever run against a real database yet.
 */

/** The minimal SQL surface the adapter needs — the injectable, fakeable seam. */
export interface SqlClient {
  /** Run a parameterized statement and return the rows. */
  query<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[],
  ): Promise<readonly T[]>;
  /** Run `fn` inside a transaction, passing a transaction-scoped client. */
  begin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  /** Cheap liveness round-trip (`select 1`). */
  ping(): Promise<void>;
  /** Close the underlying pool. */
  end(): Promise<void>;
}

export class SupabasePostgresAdapter implements DatabaseAdapter {
  private connected = false;

  constructor(private readonly sql: SqlClient) {}

  /** Build an adapter over a real postgres.js pool from the database config. */
  static fromConfig(config: DatabaseInfraConfig): SupabasePostgresAdapter {
    return new SupabasePostgresAdapter(postgresSqlClient(config));
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.sql.ping(); // eager connectivity verification (postgres.js otherwise connects lazily)
    this.connected = true;
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly T[]> {
    return this.sql.query<T>(text, params ?? []);
  }

  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.sql.begin((tx) => fn({ query: (text, params) => tx.query(text, params ?? []) }));
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      await this.sql.ping();
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.sql.end();
    this.connected = false;
  }
}

/** The raw postgres.js surface this factory relies on (cast at the boundary — verified against v3 types). */
interface RawSql {
  unsafe<T = unknown>(query: string, params?: readonly unknown[]): Promise<readonly T[]>;
  begin<T>(cb: (sql: RawSql) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}

/** Wrap a raw postgres.js instance (or a transaction-scoped one) into the clean `SqlClient` port. */
function wrapSql(raw: RawSql): SqlClient {
  return {
    query: <T = Record<string, unknown>>(text: string, params: readonly unknown[]) =>
      raw.unsafe<T>(text, params),
    begin: <T>(fn: (tx: SqlClient) => Promise<T>) => raw.begin((txRaw) => fn(wrapSql(txRaw))),
    ping: async (): Promise<void> => {
      await raw.unsafe('select 1');
    },
    end: () => raw.end({ timeout: 5 }),
  };
}

/** Build a real postgres.js-backed `SqlClient` over the DIRECT (session) connection. */
export function postgresSqlClient(config: DatabaseInfraConfig): SqlClient {
  const raw = postgres(config.connectionString, {
    max: config.maxConnections,
    prepare: false,
  }) as unknown as RawSql;
  return wrapSql(raw);
}
