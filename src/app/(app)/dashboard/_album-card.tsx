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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span>{album.title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Purchased
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <p className="text-muted-foreground">{album.size} pages</p>

        <dl className="space-y-1 text-xs text-muted-foreground">
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

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* No checkout / no delete — only completed-order actions. */}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
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
      </CardContent>
    </Card>
  );
}

// ── Editable: original card (whole-card link to builder + delete control) ──────
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

  return (
    <div className="group relative">
      <Link href={`/albums/${album.id}/build`} className="block">
        <Card className="h-full hover:ring-2 hover:ring-foreground/20 transition-shadow">
          <CardHeader>
            <CardTitle className="text-base">{album.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{album.size} pages</p>
            <p className="mt-1 text-xs capitalize text-muted-foreground">{album.status}</p>
          </CardContent>
        </Card>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div className="w-full max-w-sm rounded-xl border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Delete “{album.title}”?
              </h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(false)} disabled={deleting} aria-label="Close">
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              This permanently deletes the album, <strong>all uploaded photos</strong>, and the saved
              layout. This cannot be undone.
            </p>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
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
