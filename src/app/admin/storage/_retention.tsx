'use client';

import { useMemo, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2, FileX, ImageOff, Eye, X, AlertTriangle } from 'lucide-react';
import { purgeAlbumAssets } from '@/lib/actions/admin/storage';
import { formatBytes, PRIORITY_CHIP } from '@/lib/storage/model';
import type { RetentionRow } from '@/lib/storage/metrics';
import StatusBadge from '@/components/ui/status-badge';

type Mode = 'pdf' | 'photos' | 'all';
type Pending = { mode: Mode; albumIds: string[]; reclaim: number } | null;

const MODE_LABEL: Record<Mode, string> = { pdf: 'PDF', photos: 'photos', all: 'all assets' };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Retention queue + Cleanup Center (Phases 3 & 5). Multi-select for bulk reclaim and a
 * per-row clean-up menu. Every action is confirmed and calls the audited, R2-only,
 * eligibility-guarded `purgeAlbumAssets` server action. Read-only when !canManage.
 */
export default function RetentionQueue({ rows, canManage }: { rows: RetentionRow[]; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const byId = useMemo(() => new Map(rows.map((r) => [r.albumId, r])), [rows]);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.albumId));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.albumId)));

  const selectedRows = rows.filter((r) => selected.has(r.albumId));
  const selReclaim = selectedRows.reduce((s, r) => s + r.bytes, 0);
  const selFiles = selectedRows.reduce((s, r) => s + r.photoCount + (r.hasPdf ? 1 : 0), 0);

  const ask = (mode: Mode, albumIds: string[]) => {
    const reclaim = albumIds.reduce((s, id) => s + (byId.get(id)?.bytes ?? 0), 0);
    setPending({ mode, albumIds, reclaim });
    setMsg(null);
  };

  const confirmPurge = async () => {
    if (!pending) return;
    setBusy(true);
    let ok = 0;
    let reclaimed = 0;
    for (const albumId of pending.albumIds) {
      const res = await purgeAlbumAssets({ albumId, mode: pending.mode });
      if (res.ok) {
        ok += 1;
        reclaimed += res.reclaimed;
      }
    }
    setBusy(false);
    setPending(null);
    setSelected(new Set());
    setMsg(`Cleaned ${ok} of ${pending.albumIds.length} album${pending.albumIds.length === 1 ? '' : 's'} · ≈ ${formatBytes(reclaimed)} reclaimed.`);
    router.refresh();
  };

  return (
    <div>
      {msg && <p className="mb-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">{msg}</p>}

      {/* Cleanup Center bulk bar */}
      {canManage && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2.5 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground">≈ {formatBytes(selReclaim)} · {selFiles} files</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button type="button" onClick={() => ask('pdf', selectedRows.map((r) => r.albumId))} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">
              <FileX className="h-3.5 w-3.5" /> Delete PDFs
            </button>
            <button type="button" onClick={() => ask('photos', selectedRows.map((r) => r.albumId))} disabled={busy} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50">
              <ImageOff className="h-3.5 w-3.5" /> Delete photos
            </button>
            <button type="button" onClick={() => ask('all', selectedRows.map((r) => r.albumId))} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Delete everything
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              {canManage && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              <th className="px-3 py-2">Album / Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Delivered</th>
              <th className="px-3 py-2 text-center">Days</th>
              <th className="px-3 py-2 text-center">Photos</th>
              <th className="px-3 py-2 text-center">PDF</th>
              <th className="px-3 py-2 text-right">Est. size</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.albumId} className={`border-b last:border-0 hover:bg-muted/30 ${selected.has(r.albumId) ? 'bg-muted/40' : ''}`}>
                {canManage && (
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.albumId)} onChange={() => toggle(r.albumId)} aria-label={`Select ${r.title ?? r.albumId}`} />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link href={`/admin/albums/${r.albumId}`} className="text-primary hover:underline">{r.title ?? 'Album'}</Link>
                  <div className="font-mono text-xs text-muted-foreground">order #{r.orderId.slice(0, 8)}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.customer}</td>
                <td className="px-3 py-2 text-muted-foreground">{fmt(r.deliveredAt)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.daysSince}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.photoCount}</td>
                <td className="px-3 py-2 text-center text-muted-foreground">{r.hasPdf ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">≈ {formatBytes(r.bytes)}</td>
                <td className="px-3 py-2">
                  <StatusBadge className={PRIORITY_CHIP[r.priority]} label={r.priority} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/admin/albums/${r.albumId}`} title="View assets" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      <Eye className="h-3.5 w-3.5" /> View
                    </Link>
                    {canManage && (
                      <>
                        {r.hasPdf && (
                          <button type="button" onClick={() => ask('pdf', [r.albumId])} disabled={busy} title="Delete PDF" className="inline-flex items-center rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                            <FileX className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {r.photoCount > 0 && (
                          <button type="button" onClick={() => ask('photos', [r.albumId])} disabled={busy} title="Delete photos" className="inline-flex items-center rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                            <ImageOff className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={() => ask('all', [r.albumId])} disabled={busy} title="Delete all assets" className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Confirmation */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm" onClick={() => !busy && setPending(null)}>
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Delete {MODE_LABEL[pending.mode]}?
              </h3>
              <button type="button" onClick={() => setPending(null)} disabled={busy} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This permanently deletes the <strong>{MODE_LABEL[pending.mode]}</strong> R2 object{pending.albumIds.length > 1 ? 's' : ''} for{' '}
              <strong>{pending.albumIds.length} album{pending.albumIds.length === 1 ? '' : 's'}</strong> (≈ {formatBytes(pending.reclaim)} reclaimed).
              Order, payment, and album metadata are kept — only the stored files are removed.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPending(null)} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="button" onClick={confirmPurge} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
                {busy ? <InlineLoader /> : <Trash2 className="h-4 w-4" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
