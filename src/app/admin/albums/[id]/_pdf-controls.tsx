'use client';

import { useCallback, useEffect, useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { FileDown, RefreshCw, FileText, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminGenerateAlbumPdf } from '@/lib/actions/admin/pdf';

type PdfStatus = 'idle' | 'generating' | 'ready' | 'failed';

/**
 * Admin-only full PDF controls (Preview/Generate/Regenerate/Download). PDF generation
 * is a backend workflow customers never touch — admins keep the manual controls here.
 * Reads status from the admin-gated route and polls while generating; the generate /
 * regenerate action is the `requireAdmin()`-gated server action.
 */
export default function AdminPdfControls({ albumId }: { albumId: string }) {
  const [status, setStatus] = useState<PdfStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [failReason, setFailReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/albums/${albumId}/pdf`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { status: PdfStatus; error?: string | null };
      setStatus(body.status);
      setFailReason(body.status === 'failed' ? body.error ?? null : null);
    } catch {
      /* transient */
    }
  }, [albumId]);

  // Initial read + poll while generating.
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (status !== 'generating') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [status, refresh]);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    const res = await adminGenerateAlbumPdf(albumId);
    setBusy(false);
    if (res.ok) setStatus('generating');
    else setErr(res.error);
  };

  const download = async () => {
    setDownloading(true);
    setErr(null);
    try {
      // no-store: the just-generated 'ready' status + signed URL must never be served from
      // a stale cached poll response (that read as "not available" even when ready).
      const res = await fetch(`/api/admin/albums/${albumId}/pdf`, { cache: 'no-store' });
      const body = (await res.json()) as { status: PdfStatus; url: string | null };
      if (body.status === 'ready' && body.url) window.location.href = body.url;
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
            <Button variant="outline" size="sm" disabled>
              <InlineLoader /> Generating PDF…
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
          <span className="text-xs text-destructive">
            Last generation failed{failReason ? `: ${failReason}` : '.'}
          </span>
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
