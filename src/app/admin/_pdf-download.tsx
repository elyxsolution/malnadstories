'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Admin preview-PDF download. Fetches a fresh short-lived signed URL from the
 *  admin-gated route at click time (never stores it). */
export default function AdminPdfDownload({ albumId }: { albumId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/albums/${albumId}/pdf`);
      const body = (await res.json()) as { status: string; url: string | null };
      if (body.status === 'ready' && body.url) window.location.href = body.url;
      else setErr('No preview PDF available for this album yet.');
    } catch {
      setErr('Could not fetch the PDF link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" onClick={download} disabled={busy}>
        {busy ? <InlineLoader /> : <FileDown />} Download PDF
      </Button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
