import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Plus } from 'lucide-react';
import { db } from '@/db';
import { contentPages } from '@/db/schema';
import { requireCmsCapability } from '@/lib/cms/access';
import {
  CONTENT_TYPES,
  CONTENT_STATUSES,
  typeLabel,
  statusLabel,
  isContentType,
  isContentStatus,
} from '@/lib/cms/model';
import ContentList, { type ContentRow } from './_list';

const PAGE_SIZE = 25;

export default async function CmsContentPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; status?: string; page?: string };
}) {
  await requireCmsCapability('cms:edit');

  const q = (searchParams.q ?? '').trim();
  const type = isContentType(searchParams.type ?? '') ? searchParams.type! : '';
  const status = isContentStatus(searchParams.status ?? '') ? searchParams.status! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conds = [];
  if (type) conds.push(eq(contentPages.type, type));
  if (status) conds.push(eq(contentPages.status, status));
  if (q) conds.push(or(ilike(contentPages.title, `%${q}%`), ilike(contentPages.slug, `%${q}%`))!);
  const where = conds.length ? and(...conds) : sql`true`;

  const [rows, totalRes] = await Promise.all([
    db
      .select({
        id: contentPages.id,
        title: contentPages.title,
        slug: contentPages.slug,
        type: contentPages.type,
        status: contentPages.status,
        updatedAt: contentPages.updatedAt,
      })
      .from(contentPages)
      .where(where)
      .orderBy(desc(contentPages.updatedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ c: count() }).from(contentPages).where(where),
  ]);

  const total = totalRes[0]?.c ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefWith = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, type, status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, String(v));
    const s = sp.toString();
    return `/admin/cms/content${s ? `?${s}` : ''}`;
  };

  const typeTabs = [{ key: '', label: 'All types' }, ...CONTENT_TYPES.map((t) => ({ key: t, label: typeLabel(t) }))];
  const statusTabs = [{ key: '', label: 'All' }, ...CONTENT_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))];

  const listRows: ContentRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    type: r.type,
    status: r.status,
    updatedAt: r.updatedAt as unknown as string,
  }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Content</h1>
          <span className="text-sm text-muted-foreground">{total} total</span>
        </div>
        <Link
          href="/admin/cms/content/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New content
        </Link>
      </div>

      {/* Type filter */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {typeTabs.map((t) => {
          const active = type === t.key;
          return (
            <Link
              key={t.key || 'all'}
              href={hrefWith({ type: t.key || undefined, page: undefined })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Status filter + search */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {type && <input type="hidden" name="type" value={type} />}
        <div className="flex flex-wrap gap-1.5">
          {statusTabs.map((t) => {
            const active = status === t.key;
            return (
              <Link
                key={t.key || 'all'}
                href={hrefWith({ status: t.key || undefined, page: undefined })}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search title or slug…"
            className="h-8 w-[220px] rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
          />
          <button type="submit" className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
            Search
          </button>
        </div>
      </form>

      <ContentList rows={listRows} />

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
