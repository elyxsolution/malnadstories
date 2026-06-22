'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, PauseCircle, Archive, Copy } from 'lucide-react';
import { setTemplateStatus, duplicateTemplate } from '@/lib/actions/admin/templates';
import { categoryLabel, statusLabel, statusChip, type TemplateGeometry } from '@/lib/templates/model';
import { fmtDateTime, shortId } from '@/lib/admin/format';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';
import TemplatePreview from './_preview';

export type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  status: string;
  geometry: TemplateGeometry;
  updatedAt: string;
};

/**
 * Template cards with inline Activate / Deactivate / Archive / Duplicate. Each card shows
 * the geometry preview (the same one the builder renders). Actions call the
 * requireTemplateCapability-gated server actions and refresh.
 */
export default function TemplateList({ rows }: { rows: TemplateRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
    else setMsg(res.error ?? 'Something went wrong.');
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No matching templates"
        description="No layout templates match these filters. Clear them, or create a new template to get started."
        action={{ label: 'New template', href: '/admin/templates/new' }}
      />
    );
  }

  return (
    <div>
      {msg && <p className="mb-3 text-sm text-destructive">{msg}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-col rounded-lg border bg-card p-3">
            <Link href={`/admin/templates/${r.id}`} className="block">
              <TemplatePreview geometry={r.geometry} />
            </Link>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/admin/templates/${r.id}`} className="block truncate font-medium text-primary hover:underline">
                  {r.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {categoryLabel(r.category)} · #{shortId(r.id)}
                </p>
              </div>
              <StatusBadge className={`flex-none ${statusChip(r.status)}`} label={statusLabel(r.status)} />

            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
              {r.status !== 'active' && (
                <button
                  type="button"
                  onClick={() => run(`act-${r.id}`, () => setTemplateStatus({ id: r.id, status: 'active' }))}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === `act-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Activate
                </button>
              )}
              {r.status === 'active' && (
                <button
                  type="button"
                  onClick={() => run(`deact-${r.id}`, () => setTemplateStatus({ id: r.id, status: 'inactive' }))}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  {busy === `deact-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}
                  Deactivate
                </button>
              )}
              {r.status !== 'archived' && (
                <button
                  type="button"
                  onClick={() => run(`arch-${r.id}`, () => setTemplateStatus({ id: r.id, status: 'archived' }))}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {busy === `arch-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                  Archive
                </button>
              )}
              <button
                type="button"
                onClick={() => run(`dup-${r.id}`, () => duplicateTemplate({ id: r.id }))}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === `dup-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Duplicate
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Updated {fmtDateTime(r.updatedAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
