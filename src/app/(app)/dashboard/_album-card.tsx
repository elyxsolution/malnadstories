'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Trash2,
  Loader2,
  X,
  AlertTriangle,
  CheckCircle2,
  ReceiptText,
  Image as ImageIcon,
  FileDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteAlbum } from '@/lib/actions/albums';
import { orderStatusView } from '@/lib/orders/status';

export type AlbumCardData = { id: string; title: string; size: number; status: string };

/** A paid order on this album (from the dashboard's RLS-scoped orders query). */
export type Purchase = {
  orderId: string;
  status: string;
  placedAt: string;
  pdfReady: boolean;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Editable-album state (draft / submitted) — distinct from an ORDER status. Kept tiny
// and local; it maps the two backend album.status values to a calm label + tone.
const ALBUM_STATE: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: 'Draft', cls: 'text-muted-foreground bg-muted', dot: 'bg-muted-foreground/60' },
  submitted: { label: 'Ready to order', cls: 'text-primary bg-primary/10', dot: 'bg-primary' },
};

/** A small book-spine motif so the shelf reads as a library of bound volumes. */
function Spine({ title }: { title: string }) {
  return (
    <div className="flex h-20 shrink-0 overflow-hidden rounded-md shadow-[0_8px_18px_-8px_rgb(16_24_20/0.45)]">
      <div className="w-1.5 bg-[linear-gradient(90deg,hsl(160_28%_12%),hsl(158_26%_20%))]" />
      <div className="flex w-14 flex-col items-center justify-center bg-[linear-gradient(140deg,hsl(158_30%_22%),hsl(160_30%_14%))] px-1.5 text-center">
        <span className="text-[6px] uppercase tracking-[0.18em] text-[hsl(40_45%_70%)]">Malnad</span>
        <span className="mt-1 line-clamp-3 font-display text-[10px] leading-tight text-[hsl(42_55%_82%)]">{title}</span>
      </div>
      <div className="w-1 bg-[repeating-linear-gradient(90deg,#f3ecdd,#f3ecdd_1px,#e3d8c2_1px,#e3d8c2_3px)]" />
    </div>
  );
}

export default function AlbumCard({
  album,
  purchase = null,
}: {
  album: AlbumCardData;
  purchase?: Purchase | null;
}) {
  // A purchased album is a completed order: read-only, no delete, no checkout.
  if (purchase) return <PurchasedCard album={album} purchase={purchase} />;
  return <EditableCard album={album} />;
}

// ── Purchased: ✓ Purchased badge + order meta + non-mutating actions ───────────
function PurchasedCard({ album, purchase }: { album: AlbumCardData; purchase: Purchase }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = orderStatusView(purchase.status);

  // Fetch a fresh short-lived signed URL at click time (ownership re-checked by the
  // route). Never store the URL; it expires quickly.
  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/albums/${album.id}/pdf`);
      const body = (await res.json()) as { status: string; url: string | null };
      if (body.status === 'ready' && body.url) window.location.href = body.url;
      else setError('PDF not available yet.');
    } catch {
      setError('Could not start the download.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-5 shadow-card transition-shadow duration-200 hover:shadow-elevated">
      <div className="flex items-start gap-4">
        <Spine title={album.title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 font-display text-[17px] font-semibold leading-tight tracking-tight">{album.title}</h2>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" /> Purchased
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{album.size} pages</p>
        </div>
      </div>

      <dl className="mt-4 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>Order</dt>
          <dd className="font-mono">#{purchase.orderId.slice(0, 8)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Purchased</dt>
          <dd>{fmtDate(purchase.placedAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Status</dt>
          <dd className="font-medium text-foreground">{view.label}</dd>
        </div>
      </dl>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {/* No checkout / no delete — only completed-order actions. */}
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button size="sm" variant="secondary" render={<Link href={`/orders/${purchase.orderId}`} />}>
          <ReceiptText /> View order
        </Button>
        <Button size="sm" variant="outline" render={<Link href={`/albums/${album.id}/build`} />}>
          <ImageIcon /> View album
        </Button>
        {purchase.pdfReady && (
          <Button size="sm" variant="ghost" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="animate-spin" /> : <FileDown />} Download
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Editable: whole-card link to builder + delete control ──────────────────────
function EditableCard({ album }: { album: AlbumCardData }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    setDeleting(true);
    setError(null);
    const res = await deleteAlbum(album.id);
    if (res.ok) {
      router.refresh(); // re-render the server grid without this album
    } else {
      setError(res.error);
      setDeleting(false);
    }
  };

  const state = ALBUM_STATE[album.status] ?? ALBUM_STATE.draft;

  return (
    <div className="group relative">
      <Link href={`/albums/${album.id}/build`} className="block">
        <div className="flex h-full items-start gap-4 rounded-2xl border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated">
          <Spine title={album.title} />
          <div className="min-w-0 flex-1">
            <h2 className="min-w-0 font-display text-[17px] font-semibold leading-tight tracking-tight">{album.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{album.size} pages</p>
            <span
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${state.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
              {state.label}
            </span>
          </div>
        </div>
      </Link>

      {/* Sibling of the Link (not a child), so clicking it never navigates. */}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${album.title}`}
        className="absolute right-2 top-2 rounded-md bg-background/80 p-1.5 text-destructive opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="animate-rise w-full max-w-sm rounded-2xl border bg-card p-5 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Delete “{album.title}”?
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(false)} disabled={deleting} aria-label="Close">
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This permanently deletes the album, <strong>all uploaded photos</strong>, and the saved layout. This cannot
              be undone.
            </p>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onConfirm} disabled={deleting}>
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
