'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileDown, RefreshCw, FileText, AlertTriangle } from 'lucide-react';
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

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/albums/${albumId}/pdf`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { status: PdfStatus };
      setStatus(body.status);
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
      const res = await fetch(`/api/admin/albums/${albumId}/pdf`);
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
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="animate-spin" /> Generating PDF…
          </Button>
        ) : status === 'ready' ? (
          <>
            <Button variant="outline" size="sm" onClick={download} disabled={downloading}>
              {downloading ? <Loader2 className="animate-spin" /> : <FileDown />} Download PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
            </Button>
          </>
        ) : status === 'failed' ? (
          <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <AlertTriangle className="text-destructive" />} Retry PDF
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <FileText />} Generate PDF
          </Button>
        )}
        {status === 'failed' && <span className="text-xs text-destructive">Last generation failed.</span>}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
