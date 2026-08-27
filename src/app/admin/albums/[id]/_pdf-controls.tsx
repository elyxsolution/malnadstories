'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InlineLoader } from '@/components/loading';
import { FileDown, RefreshCw, FileText, AlertTriangle, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminGenerateAlbumPdf, adminForceGeneratePdf } from '@/lib/actions/admin/pdf';
import { pdfStageLabel, pdfFailureLabel } from '@/lib/pdf/status';
import PrintFiles from './_print-files';
import { usePdfStatus } from './_use-pdf-status';

/**
 * Admin-only full PDF controls (Preview/Generate/Regenerate/Download). PDF generation
 * is a backend workflow customers never touch — admins keep the manual controls here.
 * Reads status from the admin-gated route and polls while generating; the generate /
 * regenerate action is the `requireAdmin()`-gated server action.
 */
export default function AdminPdfControls({
  albumId,
  printReady = true,
  blockingIssues = [],
  contentPages,
}: {
  albumId: string;
  printReady?: boolean;
  blockingIssues?: string[];
  /** The album's content page count — shown on the interior print row. */
  contentPages: number;
}) {
  const router = useRouter();
  // The PREVIEW artifact (0058). `refreshOnTerminal` keeps the server-rendered diagnostics panel
  // in step when a render completes — see the hook for why only the preview needs it.
  const pdf = usePdfStatus(albumId, 'preview', { refreshOnTerminal: true });
  const { status, stage, failureCode, failReason } = pdf;
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [forceOpen, setForceOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [forcing, setForcing] = useState(false);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    const res = await adminGenerateAlbumPdf(albumId);
    setBusy(false);
    if (res.ok) {
      pdf.markGenerating();
      router.refresh(); // keep the server-rendered diagnostics panel in step from the first frame
    } else setErr(res.error);
  };

  const forceGenerate = async () => {
    setForcing(true);
    setErr(null);
    const res = await adminForceGeneratePdf({ albumId, reason: reason.trim() });
    setForcing(false);
    if (res.ok) {
      setForceOpen(false);
      setReason('');
      pdf.markGenerating();
      router.refresh();
    } else {
      setErr(res.error);
    }
  };

  const download = async () => {
    setDownloading(true);
    setErr(null);
    try {
      const url = await pdf.fetchDownloadUrl();
      if (url) window.location.href = url;
      else setErr('No preview PDF available for this album yet.');
    } catch {
      setErr('Could not fetch the PDF link.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'generating' ? (
          <>
            <Button variant="outline" size="sm" disabled title={`Stage: ${pdfStageLabel(stage)}`}>
              <InlineLoader /> {pdfStageLabel(stage)}…
            </Button>
            {/* Manual escape from a permanently-stuck 'generating' row (e.g. the worker
                died before the recovery sweep ran). Force-restarts via the same gated
                action; the worker sweep is the automatic backstop. */}
            <Button variant="ghost" size="sm" onClick={generate} disabled={busy} title="Restart if this has been generating too long">
              {busy ? <InlineLoader /> : <RefreshCw />} Restart
            </Button>
          </>
        ) : status === 'ready' ? (
          <>
            <Button variant="outline" size="sm" onClick={download} disabled={downloading}>
              {downloading ? <InlineLoader /> : <FileDown />} Download PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={generate} disabled={busy}>
              {busy ? <InlineLoader /> : <RefreshCw />} Regenerate
            </Button>
          </>
        ) : status === 'failed' ? (
          <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
            {busy ? <InlineLoader /> : <AlertTriangle className="text-destructive" />} Retry PDF
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
            {busy ? <InlineLoader /> : <FileText />} Generate PDF
          </Button>
        )}
        {status === 'failed' && (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-destructive">
            {/* Typed reason first (Section 8), raw detail as a tooltip for deeper diagnosis. */}
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium" title={failReason ?? undefined}>
              {pdfFailureLabel(failureCode)}
            </span>
            {failReason && <span className="text-muted-foreground">— {failReason}</span>}
          </span>
        )}

        {/* Force generate — the explicit, audited override that bypasses the validation gate.
            Shown when the album isn't print-ready (the only time an override is meaningful). */}
        {!printReady && status !== 'generating' && (
          <Button variant="ghost" size="sm" className="text-warning hover:bg-warning/10 hover:text-warning" onClick={() => setForceOpen(true)} disabled={busy}>
            <ShieldAlert className="h-4 w-4" /> Force generate (override)
          </Button>
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}

      {/* The printer-ready exports (0058) — deliberately quieter than the preview control above. */}
      <PrintFiles albumId={albumId} contentPages={contentPages} />

      {forceOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm" onClick={() => !forcing && setForceOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-warning/10 text-warning">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-foreground">Force-generate this PDF?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This album is <strong className="text-foreground">not print-ready</strong>. Forcing generation overrides
                  the validation gate — the printed book may contain these issues:
                </p>
              </div>
            </div>
            {blockingIssues.length > 0 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm text-foreground">
                {blockingIssues.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-warning" /> {t}
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-4 block text-sm font-medium text-foreground">
              Reason for override <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Customer approved printing despite the blank page 8."
              className="mt-1.5 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">Recorded in the audit log with your name, the time, and the validation report.</p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="sm" onClick={() => setForceOpen(false)} disabled={forcing}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-warning text-warning-foreground hover:bg-warning/90"
                onClick={forceGenerate}
                disabled={forcing || reason.trim().length < 8}
              >
                {forcing ? <InlineLoader /> : <ShieldAlert className="h-4 w-4" />} Confirm &amp; force-generate
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
