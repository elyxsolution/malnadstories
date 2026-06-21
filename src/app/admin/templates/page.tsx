import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Plus, BookImage } from 'lucide-react';
import { db } from '@/db';
import { layoutTemplates } from '@/db/schema';
import { requireTemplateCapability } from '@/lib/templates/access';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  categoryLabel,
  statusLabel,
  isTemplateCategory,
  isTemplateStatus,
  normalizeGeometry,
} from '@/lib/templates/model';
import TemplateList, { type TemplateRow } from './_list';

const PAGE_SIZE = 24;

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; status?: string; page?: string };
}) {
  await requireTemplateCapability('template:edit');

  const q = (searchParams.q ?? '').trim();
  const category = isTemplateCategory(searchParams.category ?? '') ? searchParams.category! : '';
  const status = isTemplateStatus(searchParams.status ?? '') ? searchParams.status! : '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conds = [];
  if (category) conds.push(eq(layoutTemplates.category, category));
  if (status) conds.push(eq(layoutTemplates.status, status));
  if (q) conds.push(or(ilike(layoutTemplates.name, `%${q}%`), ilike(layoutTemplates.slug, `%${q}%`))!);
  const where = conds.length ? and(...conds) : sql`true`;

  const [rows, totalRes] = await Promise.all([
    db
      .select({
        id: layoutTemplates.id,
        name: layoutTemplates.name,
        slug: layoutTemplates.slug,
        category: layoutTemplates.category,
        status: layoutTemplates.status,
        geometry: layoutTemplates.geometry,
        updatedAt: layoutTemplates.updatedAt,
      })
      .from(layoutTemplates)
      .where(where)
      .orderBy(desc(layoutTemplates.updatedAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ c: count() }).from(layoutTemplates).where(where),
  ]);

  const total = totalRes[0]?.c ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefWith = (patch: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { q, category, status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, String(v));
    const s = sp.toString();
    return `/admin/templates${s ? `?${s}` : ''}`;
  };

  const catTabs = [{ key: '', label: 'All' }, ...TEMPLATE_CATEGORIES.map((c) => ({ key: c, label: categoryLabel(c) }))];
  const statusTabs = [{ key: '', label: 'Any status' }, ...TEMPLATE_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))];

  const listRows: TemplateRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    category: r.category,
    status: r.status,
    geometry: normalizeGeometry(r.geometry),
    updatedAt: r.updatedAt as unknown as string,
  }));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Layout templates</h1>
          <p className="text-sm text-muted-foreground">Curated layout presets the builder &amp; auto-layout can use.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/covers"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <BookImage className="h-4 w-4" /> Cover styles
          </Link>
          <Link
            href="/admin/templates/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New template
          </Link>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {catTabs.map((t) => {
          const active = category === t.key;
          return (
            <Link
              key={t.key || 'all'}
              href={hrefWith({ category: t.key || undefined, page: undefined })}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {category && <input type="hidden" name="category" value={category} />}
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
            placeholder="Search name or slug…"
            className="h-8 w-[220px] rounded-md border bg-background px-3 text-sm outline-none focus:border-ring"
          />
          <button type="submit" className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
            Search
          </button>
        </div>
      </form>

      <TemplateList rows={listRows} />

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
