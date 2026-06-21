import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { supportTickets, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import {
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  SUPPORT_CATEGORIES,
  adminStatusLabel,
  categoryLabel,
  priorityLabel,
  statusChip,
  priorityChip,
  isSupportStatus,
  isSupportPriority,
  isSupportCategory,
} from '@/lib/support/model';

const PAGE_SIZE = 25;

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; priority?: string; category?: string; page?: string };
}) {
  await requireAdmin();

  const q = (searchParams.q ?? '').trim();
  const status = isSupportStatus(searchParams.status ?? '') ? searchParams.status! : '';
  const priority = isSupportPriority(searchParams.priority ?? '') ? searchParams.priority! : '';
  const category = isSupportCategory(searchParams.category ?? '') ? searchParams.category! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conds = [];
  if (status) conds.push(eq(supportTickets.status, status));
  if (priority) conds.push(eq(supportTickets.priority, priority));
  if (category) conds.push(eq(supportTickets.category, category));
  if (q) {
    conds.push(
      or(
        sql`${supportTickets.id}::text ilike ${`%${q}%`}`,
        ilike(supportTickets.subject, `%${q}%`),
        ilike(profiles.name, `%${q}%`),
      )!,
    );
  }
  const where = conds.length ? and(...conds) : sql`true`;

  const [rows, totalRows, statusRows] = await Promise.all([
    db
      .select({
        id: supportTickets.id,
        subject: supportTickets.subject,
        category: supportTickets.category,
        priority: supportTickets.priority,
        status: supportTickets.status,
        updatedAt: supportTickets.updatedAt,
        customerId: supportTickets.customerId,
        customerName: profiles.name,
        assignedTo: supportTickets.assignedTo,
      })
      .from(supportTickets)
      .leftJoin(profiles, eq(supportTickets.customerId, profiles.id))
      .where(where)
      .orderBy(desc(supportTickets.updatedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ c: count() })
      .from(supportTickets)
      .leftJoin(profiles, eq(supportTickets.customerId, profiles.id))
      .where(where),
    db.select({ status: supportTickets.status, c: count() }).from(supportTickets).groupBy(supportTickets.status),
  ]);

  const total = totalRows[0]?.c ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const emails = await adminUserEmails(rows.map((r) => r.customerId));

  const counts: Record<string, number> = {};
  for (const s of statusRows) counts[s.status] = s.c;
  const openCount = (counts.open ?? 0) + (counts.in_progress ?? 0) + (counts.waiting_for_customer ?? 0);

  // Preserve other filters when switching one (querystring builder).
  const hrefWith = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const base = { q, status, priority, category };
    const merged = { ...base, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, String(v));
    const s = sp.toString();
    return `/admin/support${s ? `?${s}` : ''}`;
  };

  const statusTabs = [
    { key: '', label: 'All' },
    ...SUPPORT_STATUSES.map((s) => ({ key: s, label: adminStatusLabel(s) })),
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Support</h1>
        <span className="text-sm text-muted-foreground">
          {openCount} open · {total} total
        </span>
      </div>

      {/* Status tabs */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {statusTabs.map((t) => {
          const active = status === t.key;
          return (
            <Link
              key={t.key || 'all'}
              href={hrefWith({ status: t.key || undefined, page: undefined })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {t.label}
              {t.key && counts[t.key] ? <span className="ml-1 opacity-70">{counts[t.key]}</span> : null}
            </Link>
          );
        })}
      </div>

      {/* Search + priority/category (GET form — no client needed) */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search subject, customer, id…"
          className="h-8 w-[240px] rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
        />
        <select name="priority" defaultValue={priority} className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">All priorities</option>
          {SUPPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p)}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={category} className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">All categories</option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <button type="submit" className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          Apply
        </button>
        {(q || priority || category) && (
          <Link href={hrefWith({ q: undefined, priority: undefined, category: undefined, page: undefined })} className="text-sm text-muted-foreground hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No tickets match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/admin/support/${r.id}`} className="font-mono text-primary hover:underline">
                      #{shortId(r.id)}
                    </Link>
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <Link href={`/admin/support/${r.id}`} className="block truncate hover:underline">
                      {r.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.customerName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{emails.get(r.customerId) ?? ''}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{categoryLabel(r.category)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityChip(r.priority)}`}>
                      {priorityLabel(r.priority)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.status)}`}>
                      {adminStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.updatedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={hrefWith({ page: page - 1 })} className="rounded-lg border px-3 py-1 hover:bg-muted">
                ← Prev
              </Link>
            )}
            {page < totalPages && (
              <Link href={hrefWith({ page: page + 1 })} className="rounded-lg border px-3 py-1 hover:bg-muted">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
