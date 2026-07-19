'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, PauseCircle, Archive, Copy, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setTemplateStatus, duplicateTemplate, checkLayoutPresetDependencies, deleteLayoutPreset, type PresetDeps } from '@/lib/actions/admin/templates';
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
  // Safe-delete flow: the row being considered + its dependency analysis.
  const [del, setDel] = useState<TemplateRow | null>(null);
  const [deps, setDeps] = useState<PresetDeps | null>(null);
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) router.refresh();
    else setMsg(res.error ?? 'Something went wrong.');
  };

  // Open the delete dialog and run the dependency analysis.
  const openDelete = async (row: TemplateRow) => {
    setDel(row);
    setDeps(null);
    setChecking(true);
    const res = await checkLayoutPresetDependencies({ id: row.id });
    setChecking(false);
    if (!res.ok) {
      setDel(null);
      setMsg(res.error);
      return;
    }
    setDeps(res.deps);
  };

  const confirmDelete = async () => {
    if (!del) return;
    setWorking(true);
    const res = await deleteLayoutPreset({ id: del.id });
    setWorking(false);
    if (res.ok) {
      setDel(null);
      router.refresh();
    } else if (res.blocked && res.deps) {
      setDeps(res.deps); // a race added a reference — reflect it
    } else {
      setMsg(res.error);
      setDel(null);
    }
  };

  const archiveInstead = async () => {
    if (!del) return;
    setWorking(true);
    const res = await setTemplateStatus({ id: del.id, status: 'archived' });
    setWorking(false);
    setDel(null);
    if (res.ok) router.refresh();
    else setMsg(res.error);
  };

  const blocked = !!deps && (deps.albums > 0 || deps.blueprints > 0);

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
                  {categoryLabel(r.category)} · {(r.geometry.base === 'single-pair' ? 2 : 1) + r.geometry.overlays.length} photos · #{shortId(r.id)}
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
                  {busy === `act-${r.id}` ? <InlineLoader /> : <CheckCircle2 className="h-3.5 w-3.5" />}
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
                  {busy === `deact-${r.id}` ? <InlineLoader /> : <PauseCircle className="h-3.5 w-3.5" />}
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
                  {busy === `arch-${r.id}` ? <InlineLoader /> : <Archive className="h-3.5 w-3.5" />}
                  Archive
                </button>
              )}
              <button
                type="button"
                onClick={() => run(`dup-${r.id}`, () => duplicateTemplate({ id: r.id }))}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === `dup-${r.id}` ? <InlineLoader /> : <Copy className="h-3.5 w-3.5" />}
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => openDelete(r)}
                disabled={busy !== null || working}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Updated {fmtDateTime(r.updatedAt)}</p>
          </div>
        ))}
      </div>

      {/* Safe-delete dialog: dependency analysis → permanent delete (if unused) or archive (if used). */}
      {del && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !working && setDel(null)}>
          <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className={`grid h-9 w-9 place-items-center rounded-lg ${blocked ? 'bg-amber-500/12 text-amber-600' : 'bg-destructive/10 text-destructive'}`}>
                {blocked ? <AlertTriangle className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </span>
              <h2 className="text-base font-semibold">Delete “{del.name}”?</h2>
            </div>

            {checking ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <InlineLoader /> Checking where this preset is used…
              </p>
            ) : blocked && deps ? (
              <>
                <p className="mt-3 text-sm text-muted-foreground">This layout preset is currently used by</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {deps.blueprints > 0 && <li>• <span className="font-medium text-foreground">{deps.blueprints}</span> Album Blueprint{deps.blueprints === 1 ? '' : 's'}</li>}
                  {deps.albums > 0 && <li>• <span className="font-medium text-foreground">{deps.albums}</span> Album{deps.albums === 1 ? '' : 's'}</li>}
                </ul>
                <p className="mt-3 text-sm text-muted-foreground">Archive it instead if you no longer want it available.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDel(null)} disabled={working}>Cancel</Button>
                  <Button variant="outline" size="sm" onClick={archiveInstead} disabled={working} className="text-amber-600">
                    {working ? <InlineLoader /> : <Archive />} Archive instead
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  This preset isn’t used by any albums or blueprints. <span className="font-medium text-foreground">This action cannot be undone.</span>
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDel(null)} disabled={working}>Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={working}>
                    {working ? <InlineLoader /> : <Trash2 />} Delete permanently
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
