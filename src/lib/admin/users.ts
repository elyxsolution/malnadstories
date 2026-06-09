import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Resolve customer emails from auth.users for a set of profile ids. Emails live in
 * auth.users (not profiles), and the Drizzle client runs as the postgres superuser,
 * so it can read the auth schema directly — the cheapest way to attach emails to
 * admin lists without N auth-admin API calls. Admin-only data; callers are behind
 * requireAdmin().
 */
export async function adminUserEmails(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  // Expand to one bound parameter per id (`id in ($1::uuid, $2::uuid, …)`). Drizzle's
  // sql`` tag binds a JS array as a SINGLE scalar param, which Postgres rejects when
  // cast to uuid[] (22P02 "malformed array literal"). sql.join keeps every id a
  // separate, parameterized value — no injection, and it works for one or many ids.
  const idList = sql.join(
    unique.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await db.execute(
    sql`select id::text as id, email from auth.users where id in (${idList})`,
  )) as unknown as { id: string; email: string | null }[];
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, r.email ?? '');
  return map;
}

export async function adminUserEmail(id: string): Promise<string> {
  const m = await adminUserEmails([id]);
  return m.get(id) ?? '';
}
