import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Singleton to prevent connection pool exhaustion during hot reloads in dev
const globalForDb = global as typeof global & { pg?: postgres.Sql };

const pg =
  globalForDb.pg ??
  postgres(process.env.DATABASE_URL!, {
    // max=1 wedged: any Promise.all of concurrent queries (e.g. the admin dashboard
    // fires 7) had to share ONE connection, and postgres-js pipelining that onto a
    // single backend against the Supabase TRANSACTION pooler (pgbouncer, :6543) hangs
    // until statement_timeout (2min) — the source of the ~101s /admin stall. A small
    // pool gives each concurrent query its own pooled connection. 10 covers the
    // dashboard's 7-query fan-out with headroom while staying well under the pooler's
    // per-client connection budget for a single app instance.
    max: 10,
    prepare: false, // required for pgbouncer transaction mode (must stay false)
  });

if (process.env.NODE_ENV !== 'production') globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
