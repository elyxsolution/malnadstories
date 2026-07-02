'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star, Sparkles, Pin, Copy, Trash2, Eye, EyeOff, Archive, Pencil, ChevronUp, ChevronDown, Search, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { categoryLabel, statusChip, statusLabel } from '@/lib/templates/model';
import {
  setTemplateStatus,
  duplicateTemplate,
  deleteBlueprint,
  setBlueprintFeatured,
  reorderBlueprints,
  updateBlueprintMeta,
} from '@/lib/actions/admin/templates';

export type BlueprintRow = {
  id: string;
  name: string;
  category: string;
  status: string;
  pageCount: number;
  slotCount: number;
  recommendedPhotos: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  updatedAt: string;
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function BlueprintList({ rows }: { rows: BlueprintRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<BlueprintRow | null>(null);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (statusFilter === 'all' || r.status === statusFilter) &&
          (!query || r.name.toLowerCase().includes(query) || r.category.toLowerCase().includes(query)),
      ),
    [rows, query, statusFilter],
  );

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) alert(res.error);
    router.refresh();
  };

  const move = (i: number, dir: -1 | 1) => {
    const ids = filtered.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(filtered[i].id, () => reorderBlueprints({ ids }));
  };

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No album blueprints yet. Build an album, then use <span className="font-medium">Save as Blueprint</span> in the builder.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blueprints…" className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus:border-ring" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm outline-none">
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Blueprint</th>
              <th className="px-3 py-2 text-left font-medium">Pages</th>
              <th className="px-3 py-2 text-left font-medium">Capacity</th>
              <th className="px-3 py-2 text-left font-medium">Recommended</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((r, i) => {
              const active = r.status === 'active';
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <button type="button" onClick={() => move(i, -1)} disabled={busy !== null || i === 0} className="text-muted-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => move(i, 1)} disabled={busy !== null || i === filtered.length - 1} className="text-muted-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{r.name}</span>
                          {r.pinned && <Pin className="h-3 w-3 text-studio" aria-label="Pinned" />}
                          {r.featured && <Star className="h-3 w-3 text-gold" aria-label="Featured" />}
                          {r.popular && <Sparkles className="h-3 w-3 text-studio-bright" aria-label="Popular" />}
                        </div>
                        <span className="text-[11px] text-muted-foreground">{categoryLabel(r.category)} · {fmtDate(r.updatedAt)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.pageCount}</td>
                  <td className="px-3 py-2 tabular-nums font-medium">{r.slotCount}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.recommendedPhotos}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusChip(r.status)}`}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <IconBtn label="Edit" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn label={active ? 'Deactivate' : 'Activate'} busy={busy === r.id} onClick={() => run(r.id, () => setTemplateStatus({ id: r.id, status: active ? 'inactive' : 'active' }))}>
                        {active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </IconBtn>
                      <IconBtn label={r.featured ? 'Unfeature' : 'Feature'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, featured: !r.featured }))} className={r.featured ? 'text-gold' : ''}><Star className="h-4 w-4" /></IconBtn>
                      <IconBtn label={r.popular ? 'Unmark popular' : 'Mark popular'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, popular: !r.popular }))} className={r.popular ? 'text-studio-bright' : ''}><Sparkles className="h-4 w-4" /></IconBtn>
                      <IconBtn label={r.pinned ? 'Unpin' : 'Pin'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, pinned: !r.pinned }))} className={r.pinned ? 'text-studio' : ''}><Pin className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Duplicate" onClick={() => run(r.id, () => duplicateTemplate({ id: r.id }))}><Copy className="h-4 w-4" /></IconBtn>
                      {r.status !== 'archived' && (
                        <IconBtn label="Archive" onClick={() => run(r.id, () => setTemplateStatus({ id: r.id, status: 'archived' }))} className="text-amber-600"><Archive className="h-4 w-4" /></IconBtn>
                      )}
                      <IconBtn label="Delete" onClick={() => { if (confirm(`Delete blueprint “${r.name}”? This cannot be undone.`)) run(r.id, () => deleteBlueprint({ id: r.id })); }} className="text-destructive"><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditMeta row={editing} busy={busy === editing.id} onClose={() => setEditing(null)} onSave={(patch) => run(editing.id, () => updateBlueprintMeta({ id: editing.id, ...patch })).then(() => setEditing(null))} />
      )}
    </div>
  );
}

function IconBtn({ label, onClick, busy, className, children }: { label: string; onClick: () => void; busy?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={busy} onClick={onClick} className={className}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}

function EditMeta({ row, busy, onClose, onSave }: { row: BlueprintRow; busy: boolean; onClose: () => void; onSave: (patch: { name: string; description?: string; category: string }) => void }) {
  const [name, setName] = useState(row.name);
  const [category, setCategory] = useState(row.category);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit blueprint</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none">
              {['solo', 'pair', 'collage', 'panoramic', 'story'].map((c) => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">To change the layout itself, rebuild it in an album and use “Save as Blueprint”.</p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => onSave({ name: name.trim(), category })} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
