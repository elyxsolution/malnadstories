import Link from 'next/link';
import { desc, count } from 'drizzle-orm';
import { Plus } from 'lucide-react';
import { db } from '@/db';
import { contentPages } from '@/db/schema';
import { requireCmsCapability } from '@/lib/cms/access';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import { CONTENT_TYPES, typeLabel, statusLabel, statusChip } from '@/lib/cms/model';

export default async function CmsDashboardPage() {
  await requireCmsCapability('cms:edit');

  const [statusCounts, typeCounts, recent] = await Promise.all([
    db.select({ status: contentPages.status, c: count() }).from(contentPages).groupBy(contentPages.status),
    db.select({ type: contentPages.type, c: count() }).from(contentPages).groupBy(contentPages.type),
    db
      .select({
        id: contentPages.id,
        title: contentPages.title,
        type: contentPages.type,
        status: contentPages.status,
        updatedAt: contentPages.updatedAt,
      })
      .from(contentPages)
      .orderBy(desc(contentPages.updatedAt))
      .limit(8),
  ]);

  const sc: Record<string, number> = {};
  for (const r of statusCounts) sc[r.status] = r.c;
  const tc: Record<string, number> = {};
  for (const r of typeCounts) tc[r.type] = r.c;

  const stat = [
    { key: 'draft', label: 'Drafts' },
    { key: 'published', label: 'Published' },
    { key: 'archived', label: 'Archived' },
  ];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Content management</h1>
          <p className="text-sm text-muted-foreground">FAQs, testimonials, stories, homepage copy, posts.</p>
        </div>
        <Link
          href="/admin/cms/content/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New content
        </Link>
      </div>

      {/* Status counts */}
      <div className="grid grid-cols-3 gap-3">
        {stat.map((s) => (
          <div key={s.key} className="rounded-lg border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{sc[s.key] ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Per-type cards */}
      <h2 className="mb-3 mt-8 text-sm font-semibold">By type</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONTENT_TYPES.map((t) => (
          <Link
            key={t}
            href={`/admin/cms/content?type=${t}`}
            className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{typeLabel(t)}</span>
              <span className="text-lg font-bold tabular-nums text-muted-foreground group-hover:text-primary">
                {tc[t] ?? 0}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Manage {typeLabel(t).toLowerCase()}s</p>
          </Link>
        ))}
      </div>

      {/* Recently updated */}
      <h2 className="mb-3 mt-8 text-sm font-semibold">Recently updated</h2>
      {recent.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No content yet. Create your first piece above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td data-label="Title" className="px-3 py-2">
                    <Link href={`/admin/cms/content/${r.id}`} className="text-primary hover:underline">
                      {r.title}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">#{shortId(r.id)}</span>
                  </td>
                  <td data-label="Type" className="px-3 py-2">{typeLabel(r.type)}</td>
                  <td data-label="Status" className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td data-label="Updated" className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.updatedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
