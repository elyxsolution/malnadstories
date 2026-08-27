'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PdfKind } from '@/lib/pdf/kind';

export type PdfStatus = 'idle' | 'generating' | 'ready' | 'failed';

export type PdfStatusState = {
  readonly status: PdfStatus;
  readonly stage: string | null;
  readonly failureCode: string | null;
  readonly failReason: string | null;
  /** Re-read the status now (also used to pick up a just-started generation). */
  readonly refresh: () => Promise<void>;
  /** Optimistically enter `generating` after a successful start, before the first poll. */
  readonly markGenerating: () => void;
  /** Fetch a fresh short-lived signed URL for the generated file, or null if there isn't one. */
  readonly fetchDownloadUrl: () => Promise<string | null>;
};

/**
 * ONE PDF-status lifecycle, for ONE artifact kind (0058).
 *
 * Extracted from the preview control so the preview and the two printer-ready exports share a
 * single poll/refresh/download implementation instead of three copies of it. The preview's
 * behaviour is preserved exactly — including `refreshOnTerminal`, which exists for a specific
 * reason documented below and is deliberately OFF for the print rows.
 */
export function usePdfStatus(
  albumId: string,
  kind: PdfKind,
  options?: {
    /**
     * THE SERVER SNAPSHOT HAS TO BE TOLD.
     *
     * This hook polls and is always right. The rest of the admin page is NOT: the diagnostics
     * panel is server-rendered from a single `album_pdfs` read taken when the page was requested,
     * so once generation finishes it goes on saying "Rendering pages…" next to a working Download
     * button — two sources of truth, one of them frozen. The worker's completion write is a single
     * atomic statement and was never the problem.
     *
     * `router.refresh()` on the terminal transition re-runs the server components with the real
     * row. It fires ONCE per completion (guarded by the previous status), not per poll.
     *
     * Only the PREVIEW needs it: nothing server-rendered reads the print rows, so refreshing the
     * whole route when a print export finishes would be pure waste.
     */
    readonly refreshOnTerminal?: boolean;
  },
): PdfStatusState {
  const refreshOnTerminal = options?.refreshOnTerminal ?? false;
  const router = useRouter();
  const [status, setStatus] = useState<PdfStatus>('idle');
  /** The last status the poll saw — so a terminal transition is detected without an impure updater. */
  const statusRef = useRef<PdfStatus>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);

  const endpoint = `/api/admin/albums/${albumId}/pdf?kind=${encodeURIComponent(kind)}`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as {
        status: PdfStatus;
        error?: string | null;
        stage?: string | null;
        failureCode?: string | null;
      };
      // generating → ready/failed is the moment the rest of the page goes stale. Read the previous
      // value from a ref rather than a state updater: an updater must stay pure (React is free to
      // call it twice), and this is a side effect.
      const prev = statusRef.current;
      statusRef.current = body.status;
      if (refreshOnTerminal && prev === 'generating' && body.status !== 'generating') router.refresh();
      setStatus(body.status);
      setStage(body.stage ?? null);
      setFailureCode(body.status === 'failed' ? body.failureCode ?? null : null);
      setFailReason(body.status === 'failed' ? body.error ?? null : null);
    } catch {
      /* transient */
    }
  }, [endpoint, refreshOnTerminal, router]);

  // Initial read + poll while generating.
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (status !== 'generating') return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [status, refresh]);

  const markGenerating = useCallback(() => {
    statusRef.current = 'generating';
    setStatus('generating');
  }, []);

  const fetchDownloadUrl = useCallback(async () => {
    // no-store: the just-generated 'ready' status + signed URL must never be served from a stale
    // cached poll response (that read as "not available" even when ready).
    const res = await fetch(endpoint, { cache: 'no-store' });
    const body = (await res.json()) as { status: PdfStatus; url: string | null };
    return body.status === 'ready' && body.url ? body.url : null;
  }, [endpoint]);

  return { status, stage, failureCode, failReason, refresh, markGenerating, fetchDownloadUrl };
}
