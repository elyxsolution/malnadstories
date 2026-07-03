'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star, Sparkles, Pin, Copy, Trash2, Eye, EyeOff, Archive, Pencil, Search, X, Check, RefreshCw, LayoutGrid, Crown, PencilRuler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { categoryLabel, statusChip, statusLabel } from '@/lib/templates/model';
import {
  setTemplateStatus,
  duplicateTemplate,
  deleteBlueprint,
  setBlueprintFeatured,
  updateBlueprintMeta,
  regenerateBlueprintThumbnail,
  setDefaultBlueprint,
  openBlueprintForEditing,
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
  isDefault: boolean;
  breakdown: { label: string; count: number }[];
  thumbUrl: string | null;
  updatedAt: string;
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Persisted list UI (search + status filter + scroll) so returning from the builder lands the admin
// exactly where they left off — no re-finding the blueprint they just edited.
const UI_KEY = 'admin.blueprints.ui';
type UiState = { q?: string; statusFilter?: string; scrollY?: number };
const readUi = (): UiState => {
  try {
    return JSON.parse(sessionStorage.getItem(UI_KEY) || '{}') as UiState;
  } catch {
    return {};
  }
};
const writeUi = (patch: UiState) => {
  try {
    sessionStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));
  } catch {
    /* sessionStorage unavailable — non-fatal */
  }
};

/**
 * Album Blueprints — grouped by album size (Section 2). Each size has at most one Default (⭐, used
 * by Auto Create). Cards show the thumbnail, capacity, recommended, layout breakdown, badges, and
 * quick actions. Reuses the existing gated server actions; refreshes on change.
 */
export default function BlueprintList({ rows }: { rows: BlueprintRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState<BlueprintRow | null>(null);

  // Restore search/filter/scroll on mount (e.g. returning from the builder after a Save).
  useEffect(() => {
    const s = readUi();
    if (typeof s.q === 'string') setQ(s.q);
    if (typeof s.statusFilter === 'string') setStatusFilter(s.statusFilter);
    if (typeof s.scrollY === 'number' && s.scrollY > 0) {
      const y = s.scrollY;
      const t = setTimeout(() => window.scrollTo({ top: y }), 60);
      return () => clearTimeout(t);
    }
  }, []);

  // Persist filters as they change so the round-trip to the builder keeps them.
  useEffect(() => {
    writeUi({ q, statusFilter });
  }, [q, statusFilter]);

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

  // Group by album size (page count), ascending.
  const groups = useMemo(() => {
    const map = new Map<number, BlueprintRow[]>();
    for (const r of filtered) {
      const list = map.get(r.pageCount) ?? [];
      list.push(r);
      map.set(r.pageCount, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) alert(res.error);
    router.refresh();
  };

  // Edit the blueprint's LAYOUT in the existing builder (0046): open a draft, then navigate to it.
  // Save the current scroll + filters so returning from the builder restores this exact view.
  const editInBuilder = async (id: string) => {
    setBusy(id);
    const res = await openBlueprintForEditing({ id });
    if (!res.ok) {
      setBusy(null);
      return alert(res.error);
    }
    writeUi({ q, statusFilter, scrollY: window.scrollY });
    router.push(`/albums/${res.albumId}/build`);
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground"><LayoutGrid className="h-6 w-6" /></div>
        <p className="mt-3 font-medium">No album blueprints yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Click <span className="font-medium">+ New Blueprint</span> to design a complete album in the builder. Assign one default per size so Auto Create is predictable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search blueprints…"
            aria-label="Search blueprints by name or category"
            className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none transition-colors focus:border-ring focus-visible:ring-2 focus-visible:ring-studio-bright"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter blueprints by status" className="h-9 rounded-lg border bg-background px-2.5 text-sm outline-none">
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No blueprints match your filters.</p>
      ) : (
        groups.map(([size, items]) => {
          const hasDefault = items.some((b) => b.isDefault);
          return (
            <section key={size}>
              <div className="mb-2.5 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{size} Pages</h3>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{items.length}</span>
                {!hasDefault && <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600">No default set</span>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((r) => (
                  <BlueprintCard key={r.id} r={r} busy={busy === r.id} onEdit={() => setEditing(r)} onEditLayout={() => editInBuilder(r.id)} run={run} />
                ))}
              </div>
            </section>
          );
        })
      )}

      {editing && (
        <EditMeta row={editing} busy={busy === editing.id} onClose={() => setEditing(null)} onSave={(patch) => run(editing.id, () => updateBlueprintMeta({ id: editing.id, ...patch })).then(() => setEditing(null))} />
      )}
    </div>
  );
}

function BlueprintCard({
  r,
  busy,
  onEdit,
  onEditLayout,
  run,
}: {
  r: BlueprintRow;
  busy: boolean;
  onEdit: () => void;
  onEditLayout: () => void;
  run: (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  const active = r.status === 'active';
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-all duration-200 ease-glide hover:-translate-y-0.5 hover:border-studio/30 hover:shadow-card ${
        r.isDefault ? 'ring-2 ring-gold/50' : ''
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {r.thumbUrl && !thumbFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.thumbUrl}
            alt={`${r.name} preview`}
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-glide group-hover:scale-[1.03]"
          />
        ) : (
          // No thumbnail yet, or the presigned URL expired/failed — show a calm placeholder, never a broken image.
          <span className="absolute inset-0 grid place-items-center text-muted-foreground/40"><LayoutGrid className="h-6 w-6" /></span>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {r.isDefault && <Badge className="bg-gold/90 text-background"><Crown className="h-3 w-3" /> Default</Badge>}
          {r.featured && <Badge className="bg-primary/90 text-primary-foreground"><Star className="h-3 w-3" /> Featured</Badge>}
          {r.pinned && <Badge className="bg-studio text-white"><Pin className="h-3 w-3" /> Pinned</Badge>}
          {r.popular && <Badge className="bg-studio-bright/90 text-white"><Sparkles className="h-3 w-3" /> Popular</Badge>}
        </div>
        <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${statusChip(r.status)}`}>{statusLabel(r.status)}</span>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <p className="truncate text-sm font-semibold" title={r.name}>{r.name}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{categoryLabel(r.category)} · {fmtDate(r.updatedAt)}</p>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center">
          {[{ k: 'Pages', v: r.pageCount }, { k: 'Holds', v: r.slotCount }, { k: 'Rec.', v: r.recommendedPhotos }].map((s) => (
            <div key={s.k} className="rounded-md bg-secondary/50 py-1">
              <div className="text-[13px] font-semibold tabular-nums">{s.v}</div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.k}</div>
            </div>
          ))}
        </div>
        {r.breakdown.length > 0 && (
          <p className="mt-2 line-clamp-1 text-[10px] text-muted-foreground">{r.breakdown.map((b) => `${b.count} ${b.label}`).join(' · ')}</p>
        )}

        {/* Edit the layout in the builder (0046) + rename metadata */}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Button size="sm" disabled={busy} onClick={onEditLayout} className="h-7 text-[12px]">
            {busy ? <Loader2 className="animate-spin" /> : <PencilRuler className="h-3.5 w-3.5" />} Edit Blueprint
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onEdit} className="h-7 text-[12px]">
            <Pencil className="h-3.5 w-3.5" /> Rename
          </Button>
        </div>

        {/* Set default (per size) */}
        <div className="mt-2">
          {r.isDefault ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gold"><Crown className="h-3.5 w-3.5" /> Default for {r.pageCount} pages</span>
          ) : (
            <Button size="sm" variant="outline" disabled={busy || !active} onClick={() => run(r.id, () => setDefaultBlueprint({ id: r.id }))} className="h-7 w-full text-[12px]">
              {busy ? <Loader2 className="animate-spin" /> : <Crown className="h-3.5 w-3.5" />} Set as default
            </Button>
          )}
          {!active && !r.isDefault && <p className="mt-1 text-[10px] text-muted-foreground">Activate to make it selectable as default.</p>}
        </div>

        {/* Quick actions */}
        <div className="mt-2 flex flex-wrap items-center gap-0.5 border-t pt-2">
          <IconBtn label={active ? 'Deactivate' : 'Activate'} busy={busy} onClick={() => run(r.id, () => setTemplateStatus({ id: r.id, status: active ? 'inactive' : 'active' }))}>
            {active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </IconBtn>
          <IconBtn label={r.featured ? 'Unfeature' : 'Feature'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, featured: !r.featured }))} className={r.featured ? 'text-gold' : ''}><Star className="h-4 w-4" /></IconBtn>
          <IconBtn label={r.popular ? 'Unmark popular' : 'Mark popular'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, popular: !r.popular }))} className={r.popular ? 'text-studio-bright' : ''}><Sparkles className="h-4 w-4" /></IconBtn>
          <IconBtn label={r.pinned ? 'Unpin' : 'Pin'} onClick={() => run(r.id, () => setBlueprintFeatured({ id: r.id, pinned: !r.pinned }))} className={r.pinned ? 'text-studio' : ''}><Pin className="h-4 w-4" /></IconBtn>
          <IconBtn label="Duplicate" onClick={() => run(r.id, () => duplicateTemplate({ id: r.id }))}><Copy className="h-4 w-4" /></IconBtn>
          <IconBtn label="Regenerate thumbnail" onClick={() => run(r.id, () => regenerateBlueprintThumbnail({ id: r.id }))}><RefreshCw className="h-4 w-4" /></IconBtn>
          {r.status !== 'archived' && (
            <IconBtn label="Archive" onClick={() => run(r.id, () => setTemplateStatus({ id: r.id, status: 'archived' }))} className="text-amber-600"><Archive className="h-4 w-4" /></IconBtn>
          )}
          <IconBtn label="Delete" onClick={() => { if (confirm(`Delete blueprint “${r.name}”? This cannot be undone.`)) run(r.id, () => deleteBlueprint({ id: r.id })); }} className="text-destructive"><Trash2 className="h-4 w-4" /></IconBtn>
        </div>
      </div>
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>{children}</span>;
}

function IconBtn({ label, onClick, busy, className, children }: { label: string; onClick: () => void; busy?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={busy} onClick={onClick} className={className}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </Button>
  );
}

function EditMeta({ row, busy, onClose, onSave }: { row: BlueprintRow; busy: boolean; onClose: () => void; onSave: (patch: { name: string; category: string }) => void }) {
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
          <p className="text-[11px] text-muted-foreground">To change the layout itself, use <span className="font-medium">Edit Blueprint</span> on the card.</p>
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
