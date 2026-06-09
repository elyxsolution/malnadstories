'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Package,
  Truck,
  PackageCheck,
  Eye,
  FileDown,
  Loader2,
  ReceiptText,
  LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Preview from './_preview';
import { type Photo } from './_uploader';
import { type Block } from '@/lib/builder/model';
import { orderStatusView, type PurchasedStatus } from '@/lib/orders/status';

type PdfStatus = 'idle' | 'generating' | 'ready' | 'failed';

const STATUS_ICON: Record<PurchasedStatus, typeof CheckCircle2> = {
  paid: CheckCircle2,
  processing: Package,
  shipped: Truck,
  delivered: PackageCheck,
};

/**
 * Read-only post-purchase view of an album. Rendered INSTEAD of the editable
 * Builder once the album has a paid order (the page decides, server-side, from the
 * DB). There is deliberately NO edit, submit, or checkout control here — a purchased
 * album behaves like a completed order. The only actions are non-mutating: preview,
 * download the PDF, view the order, go to the dashboard.
 */
export default function PurchasedAlbum({
  albumId,
  title,
  size,
  order,
  photos,
  blocks,
  initialPdfStatus,
}: {
  albumId: string;
  title: string;
  size: number;
  order: { id: string; status: string };
  photos: Photo[];
  blocks: Block[];
  initialPdfStatus: PdfStatus;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>(initialPdfStatus);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const view = orderStatusView(order.status);
  const StatusIcon = STATUS_ICON[order.status as PurchasedStatus] ?? CheckCircle2;

  // If a PDF is mid-generation (e.g. requested elsewhere), reflect it. Read-only —
  // this never alters the album, only the cached preview artifact.
  useEffect(() => {
    if (pdfStatus !== 'generating') return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/albums/${albumId}/pdf`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: PdfStatus };
        if (active && body.status !== 'generating') setPdfStatus(body.status);
      } catch {
        // transient — retry next tick
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [pdfStatus, albumId]);

  const downloadPdf = async () => {
    setDownloading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/albums/${albumId}/pdf`);
      const body = (await res.json()) as { status: PdfStatus; url: string | null };
      if (body.status === 'ready' && body.url) {
        window.location.href = body.url;
      } else {
        setPdfStatus(body.status);
        setMessage('The album PDF is not available yet. Please try again shortly.');
      }
    } catch {
      setMessage('Could not fetch the download link. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          {' / '}
          {title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Purchased
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{size} pages</p>
      </div>

      {/* Purchase-complete + live order status card (Part 5 — status from the DB) */}
      <section
        className="rounded-xl border border-primary/30 bg-primary/5 p-5"
        aria-label="Order status"
      >
        <p className="text-sm font-semibold text-primary">Payment complete</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your order has been confirmed and is being processed.
        </p>

        <div className="mt-4 flex items-start gap-3 rounded-lg border bg-card p-3">
          <StatusIcon className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Order status
            </p>
            <p className="font-medium">{view.label}</p>
            <p className="text-sm text-muted-foreground">{view.message}</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Order #{order.id.slice(0, 8)}
        </p>
      </section>

      {message && <p className="text-sm text-destructive">{message}</p>}

      {/* Actions — non-mutating only. No checkout, no retry payment, no edit. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
          className="w-full sm:w-auto"
        >
          <Eye /> {showPreview ? 'Hide preview' : 'Preview album'}
        </Button>

        {pdfStatus === 'ready' ? (
          <Button
            variant="outline"
            onClick={downloadPdf}
            disabled={downloading}
            className="w-full sm:w-auto"
          >
            {downloading ? <Loader2 className="animate-spin" /> : <FileDown />} Download album
          </Button>
        ) : pdfStatus === 'generating' ? (
          <Button variant="outline" disabled className="w-full sm:w-auto">
            <Loader2 className="animate-spin" /> Preparing PDF…
          </Button>
        ) : null}

        <Button
          variant="secondary"
          render={<Link href={`/orders/${order.id}`} />}
          className="w-full sm:w-auto"
        >
          <ReceiptText /> View order
        </Button>
        <Button
          render={<Link href="/dashboard" />}
          className="w-full sm:w-auto"
        >
          <LayoutDashboard /> Dashboard
        </Button>
      </div>

      {/* Read-only album render (same renderer as the builder preview). */}
      {showPreview && (
        <section aria-label="Album preview" className="rounded-lg border bg-card p-4">
          <Preview blocks={blocks} photoMap={photoMap} />
        </section>
      )}
    </div>
  );
}
