'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Archive } from 'lucide-react';
import { bulkSetContentStatus } from '@/lib/actions/admin/cms';
import { typeLabel, statusLabel, statusChip } from '@/lib/cms/model';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';

export type ContentRow = {
  id: string;
  title: string;
  slug: string;
  type: string;
  status: string;
  updatedAt: string;
};

/**
 * Content table with row selection + bulk publish/archive. Selection is client state; the
 * bulk action calls the requireCmsCapability-gated server action and refreshes. Server-side
 * filtering/pagination is handled by the parent page.
 */
export default function ContentList({ rows }: { rows: ContentRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | string>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  const runBulk = async (status: 'published' | 'archived') => {
    if (selected.size === 0) return;
    setBusy(status);
    setMsg(null);
    const res = await bulkSetContentStatus({ ids: Array.from(selected), status });
    setBusy(null);
    if (res.ok) {
      setSelected(new Set());
      router.refresh();
    } else {
      setMsg(res.error ?? 'Something went wrong.');
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No matching content"
        description="No content pages match these filters. Clear them, or create a new page to get started."
        action={{ label: 'New content', href: '/admin/cms/content/new' }}
      />
    );
  }

  return (
    <div>
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm">
          <span className="px-1 font-medium">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => runBulk('published')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === 'published' ? <InlineLoader /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Publish
          </button>
          <button
            type="button"
            onClick={() => runBulk('archived')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy === 'archived' ? <InlineLoader /> : <Archive className="h-3.5 w-3.5" />}
            Archive
          </button>
          {msg && <span className="text-destructive">{msg}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="ms-stack w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.title}`}
                  />
                </td>
                <td data-label="Title" data-block className="px-3 py-2">
                  <Link href={`/admin/cms/content/${r.id}`} className="text-primary hover:underline">
                    {r.title}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">
                    {r.slug} · #{shortId(r.id)}
                  </div>
                </td>
                <td data-label="Type" className="px-3 py-2">{typeLabel(r.type)}</td>
                <td data-label="Status" className="px-3 py-2">
                  <StatusBadge className={statusChip(r.status)} label={statusLabel(r.status)} />
                </td>
                <td data-label="Updated" className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
