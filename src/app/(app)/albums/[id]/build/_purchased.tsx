'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Package, Printer, Box, Truck, PackageCheck, Eye, FileDown, FileText, BookOpen, ReceiptText, LayoutDashboard, Clock } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import { Button } from '@/components/ui/button';
import Preview from './_preview';
import { type Photo } from './_uploader';
import { type Block } from '@/lib/builder/model';
import { orderStatusView, type PurchasedStatus } from '@/lib/orders/status';
import { pdfStageLabel, pdfStageStep, pdfFailureCustomerNote, PDF_STAGE_ORDER } from '@/lib/pdf/status';
import { LUX_PRIMARY } from '@/components/brand';

type PdfStatus = 'idle' | 'generating' | 'ready' | 'failed';

const STATUS_ICON: Record<PurchasedStatus, typeof CheckCircle2> = {
  paid: CheckCircle2,
  processing: Package,
  printing: Printer,
  packed: Box,
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
  cover,
  stickerUrls = {},
  initialPdfStatus,
}: {
  albumId: string;
  title: string;
  size: number;
  order: { id: string; status: string };
  photos: Photo[];
  blocks: Block[];
  cover: { url: string; name: string } | null;
  stickerUrls?: Record<string, string>;
  initialPdfStatus: PdfStatus;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>(initialPdfStatus);
  // A file exists (r2_key) even if a regeneration is in flight (audit H-2) — the download must
  // stay available throughout a regen rather than vanishing.
  const [downloadReady, setDownloadReady] = useState(initialPdfStatus === 'ready');
  const [stage, setStage] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const photoMap = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const view = orderStatusView(order.status);
  const StatusIcon = STATUS_ICON[order.status as PurchasedStatus] ?? CheckCircle2;

  // PDF generation is a BACKEND workflow that starts automatically on payment — the
  // customer never triggers it. Poll until it's ready (the poll also nudges the worker
  // awake server-side). We keep polling on any non-ready status so a worker-side
  // recovery or an admin regenerate flips us to "Download" without a refresh.
  useEffect(() => {
    if (pdfStatus === 'ready') return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/albums/${albumId}/pdf`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: PdfStatus; downloadReady?: boolean; stage?: string | null; failureCode?: string | null };
        if (active) {
          setPdfStatus(body.status);
          setStage(body.stage ?? null);
          setFailureCode(body.failureCode ?? null);
          if (body.downloadReady) setDownloadReady(true);
        }
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
      const body = (await res.json()) as { status: PdfStatus; url: string | null; downloadReady?: boolean };
      if (body.url) {
        // A file exists → download it, even if a fresh regen is generating (H-2).
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
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Dashboard
      </Link>

      {/* Hero — what you ordered */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-xl bg-muted shadow-paper ring-1 ring-black/10">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.url} alt={cover.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
              <BookOpen className="h-6 w-6" />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-[2rem] font-semibold leading-none tracking-[-0.01em]">{title}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20">
              <CheckCircle2 className="h-3.5 w-3.5" /> Yours
            </span>
          </div>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            {size} pages, on their way to becoming a book you’ll keep for years.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Order&nbsp;#{order.id.slice(0, 8)}</p>
        </div>
      </header>

      {/* Live order status (status copy from the DB via orderStatusView) */}
      <section className="rounded-2xl border bg-card p-5 shadow-panel" aria-label="Order status">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <StatusIcon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Order status</p>
            <p className="font-display text-base font-semibold tracking-tight">{view.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{view.message}</p>
          </div>
        </div>
      </section>

      {/* Print-ready album (PDF) — honest states, no fake progress. Download shows whenever a file
          exists (downloadReady), so an in-flight regen never hides an already-generated album (H-2). */}
      {pdfStatus === 'ready' || downloadReady ? (
        <section className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5 shadow-panel sm:flex-row sm:items-center">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(180deg,hsl(158_38%_27%),hsl(158_42%_19%))] text-primary-foreground shadow-[inset_0_1px_0_0_hsl(150_50%_62%/0.3)]">
            <FileDown className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold tracking-tight text-primary">Your print-ready album is ready</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A high-resolution PDF of every page, exactly as you designed it.
            </p>
          </div>
          <Button onClick={downloadPdf} disabled={downloading} className={`w-full sm:w-auto ${LUX_PRIMARY}`}>
            {downloading ? <InlineLoader /> : <FileDown />} Download album
          </Button>
        </section>
      ) : pdfStatus === 'failed' ? (
        <section className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-panel">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground">
            <Clock className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold tracking-tight">Putting the finishing touches on it</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {pdfFailureCustomerNote(failureCode)}
            </p>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-panel" aria-label="Preparing print-ready album">
          <div className="flex items-center gap-3 border-b bg-secondary/30 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              {/* Honest stage — the real phase the worker is in (Section 6), not a fake percentage. */}
              <p className="font-display text-base font-semibold tracking-tight">{pdfStageLabel(stage)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                This usually takes a minute or two. Feel free to leave — we’ll keep it safe and ready here.
              </p>
              <div className="mt-2.5 flex items-center gap-1.5" aria-hidden>
                {PDF_STAGE_ORDER.slice(0, 5).map((s, i) => (
                  <span
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-colors duration-500 ${i < pdfStageStep(stage) ? 'bg-primary' : 'bg-border'}`}
                  />
                ))}
              </div>
            </div>
            <InlineLoader />
          </div>
          {/* Honest skeleton of an album being composed — not a fake percentage. */}
          <div className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="skeleton aspect-[3/4] rounded-lg"
                style={{ animationDelay: `${i * 180}ms` }}
              />
            ))}
          </div>
        </section>
      )}

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
        <Button variant="secondary" render={<Link href={`/orders/${order.id}`} />} className="w-full sm:w-auto">
          <ReceiptText /> View order
        </Button>
        <Button variant="ghost" render={<Link href="/dashboard" />} className="w-full sm:w-auto">
          <LayoutDashboard /> Dashboard
        </Button>
      </div>

      {/* Read-only album render (same renderer as the builder preview). */}
      {showPreview && (
        <section aria-label="Album preview" className="animate-rise rounded-2xl border bg-card p-4 shadow-panel">
          <Preview blocks={blocks} photoMap={photoMap} cover={cover} stickerUrlFor={(id) => stickerUrls[id]} />
        </section>
      )}
    </div>
  );
}
