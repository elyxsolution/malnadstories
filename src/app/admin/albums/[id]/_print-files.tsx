'use client';

import { useState } from 'react';
import { AlertTriangle, BookOpen, FileDown, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { adminGeneratePrintPdf } from '@/lib/actions/admin/pdf';
import { pdfStageLabel, pdfFailureLabel } from '@/lib/pdf/status';
import type { PdfKind } from '@/lib/pdf/kind';
import { COVER_ARTWORK, INTERIOR_ARTWORK } from '@/lib/print/spec';
import { usePdfStatus } from './_use-pdf-status';

/**
 * PRINT FILES — the two printer-ready exports (0058), Admin-on-demand.
 *
 * Visually SUBORDINATE to the preview control above it: the preview is what the page is about, and
 * these are a production tool used once a book actually goes to print. So they sit in a quiet
 * bordered group with a muted heading, and their actions are outline/ghost — never competing with
 * the primary Generate/Download the preview owns.
 *
 * The three artifacts are named explicitly (Preview PDF · Print cover · Print content) because an
 * admin handing a file to a print partner must be certain which one they downloaded. The physical
 * size is printed next to each for the same reason, straight from `lib/print/spec` so the label can
 * never drift from the file.
 */

const mm = (n: number) => `${n}`;

export default function PrintFiles({
  albumId,
  contentPages,
}: {
  albumId: string;
  /** The album's content page count — what the interior export will contain, exactly. */
  contentPages: number;
}) {
  return (
    <section className="mt-4 rounded-xl border bg-muted/20 p-3.5">
      <div className="flex items-center gap-2">
        <Printer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Print files</h3>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Printer-ready artwork with bleed. Separate from the preview PDF above — generated on demand,
        never automatically.
      </p>

      <div className="mt-3 space-y-2">
        <PrintFileRow
          albumId={albumId}
          kind="print_cover"
          icon={<BookOpen className="h-4 w-4" aria-hidden />}
          label="Cover artwork"
          spec={`${mm(COVER_ARTWORK.w)} × ${mm(COVER_ARTWORK.h)} mm · one flat spread`}
        />
        <PrintFileRow
          albumId={albumId}
          kind="print_content"
          icon={<Printer className="h-4 w-4" aria-hidden />}
          label="Content pages"
          spec={`${mm(INTERIOR_ARTWORK.w)} × ${mm(INTERIOR_ARTWORK.h)} mm · ${contentPages} pages`}
        />
      </div>
    </section>
  );
}

function PrintFileRow({
  albumId,
  kind,
  icon,
  label,
  spec,
}: {
  albumId: string;
  kind: PdfKind;
  icon: React.ReactNode;
  label: string;
  spec: string;
}) {
  const pdf = usePdfStatus(albumId, kind);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    const res = await adminGeneratePrintPdf({ albumId, kind });
    setBusy(false);
    if (res.ok) pdf.markGenerating();
    else setErr(res.error);
  };

  const download = async () => {
    setDownloading(true);
    setErr(null);
    try {
      const url = await pdf.fetchDownloadUrl();
      if (url) window.location.href = url;
      else setErr('That print file isn’t available yet.');
    } catch {
      setErr('Could not fetch the download link.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{label}</p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">{spec}</p>
          </div>
        </div>

        <div className="flex flex-none items-center gap-1.5">
          {pdf.status === 'generating' ? (
            <Button variant="outline" size="sm" disabled title={`Stage: ${pdfStageLabel(pdf.stage)}`}>
              <InlineLoader /> {pdfStageLabel(pdf.stage)}…
            </Button>
          ) : pdf.status === 'ready' ? (
            <>
              <Button variant="outline" size="sm" onClick={download} disabled={downloading}>
                {downloading ? <InlineLoader /> : <FileDown />} Download
              </Button>
              <Button variant="ghost" size="sm" onClick={generate} disabled={busy} title="Re-render from the album’s current state">
                {busy ? <InlineLoader /> : <RefreshCw />} Regenerate
              </Button>
            </>
          ) : pdf.status === 'failed' ? (
            <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
              {busy ? <InlineLoader /> : <AlertTriangle className="text-destructive" />} Retry
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
              {busy ? <InlineLoader /> : <FileDown />} Generate
            </Button>
          )}
        </div>
      </div>

      {pdf.status === 'failed' && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-destructive">
          {/* Typed reason first, raw detail as a tooltip for deeper diagnosis — same as the preview. */}
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium" title={pdf.failReason ?? undefined}>
            {pdfFailureLabel(pdf.failureCode)}
          </span>
          {pdf.failReason && <span className="text-muted-foreground">— {pdf.failReason}</span>}
        </p>
      )}
      {err && <p className="mt-2 whitespace-pre-line text-xs text-destructive">{err}</p>}
    </div>
  );
}
