import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Singleton to prevent connection pool exhaustion during hot reloads in dev
const globalForDb = global as typeof global & { pg?: postgres.Sql };

const pg =
  globalForDb.pg ??
  postgres(process.env.DATABASE_URL!, {
    max: 1, // serverless-safe: one connection per function instance
    prepare: false, // required for pgbouncer transaction mode
  });

if (process.env.NODE_ENV !== 'production') globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
