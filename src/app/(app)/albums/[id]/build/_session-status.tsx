'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { UploadSessionSummary, UploadStats } from '@/lib/uploads';
import { processingSentence } from './_photo-state';
import { useSlowTick } from './_use-tick';

/**
 * THE upload status surface — batch progress, the queue stepper, and completion feedback, in
 * one quiet strip under the dropzone.
 *
 * It replaces the single-line status of Phase 2 with something that answers the three questions
 * a person actually has during a large upload: how far along is my batch, what is happening to
 * my photos right now, and did anything go wrong.
 *
 * DESIGN: it stays a strip, never a panel. One sentence, one hairline bar, one four-dot stepper.
 * Nothing loops, nothing flashes, nothing expands or collapses under the pointer. When there is
 * nothing to report it renders nothing at all, so the rail is not permanently taller — and the
 * completion tick fades away by itself rather than needing to be dismissed.
 */

const STEPS = ['Queued', 'Uploading', 'Processing', 'Ready'] as const;

export default function SessionStatus({
  stats,
  activeSessions,
  /** Photos confirmed on the server and waiting on the worker (includes page-load hydration). */
  processing,
  /** Oldest processing start we know about — drives the escalating copy. */
  processingSince,
  failedUploads,
  rejectedPhotos,
}: {
  stats: UploadStats;
  activeSessions: UploadSessionSummary[];
  processing: number;
  processingSince: number | null;
  failedUploads: number;
  rejectedPhotos: number;
}) {
  const busy = stats.queued > 0 || stats.uploading > 0 || processing > 0;
  const now = useSlowTick(processing > 0 && processingSince !== null);

  // ── completion feedback ────────────────────────────────────────────────────────
  // A tick appears when a batch finishes and everything settles, then retires itself. It is
  // acknowledgement, not an announcement: no toast stack, no sound, nothing to dismiss.
  const [celebrate, setCelebrate] = useState(0);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (stats.completed === 0) return;
    setCelebrate(stats.completed);
    const timer = setTimeout(() => setCelebrate(0), 4000);
    return () => clearTimeout(timer);
  }, [busy, stats.completed]);

  if (!busy && failedUploads === 0 && rejectedPhotos === 0 && celebrate === 0) return null;

  // ── batch line ─────────────────────────────────────────────────────────────────
  // With a live batch, speak in "n of m" — the number people actually track. Otherwise fall
  // back to describing the phase that is still running.
  const batch = activeSessions[activeSessions.length - 1];
  const batchDone = batch ? batch.completed + batch.failed + batch.cancelled + batch.processing : 0;
  const headline = !busy
    ? null
    : batch && batch.total > 1
      ? `Uploading ${Math.min(batchDone + 1, batch.total)} of ${batch.total}`
      : stats.uploading > 0
        ? `Uploading ${stats.uploading}`
        : stats.queued > 0
          ? `${stats.queued} queued`
          : processingSentence(processingSince === null ? null : now - processingSince);

  const progress = batch ? Math.round(batch.progress * 100) : 0;

  return (
    <div aria-live="polite" className="mt-2.5 space-y-2 rounded-lg bg-secondary/60 px-2.5 py-2 ring-1 ring-border/60">
      {busy && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] font-medium leading-tight text-foreground">{headline}</p>
            {batch && batch.total > 1 && (
              <span className="flex-none text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
            )}
          </div>

          {batch && batch.total > 1 && (
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-studio transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* THE QUEUE, MADE LEGIBLE. Four dots in the order photos actually travel, each lit
              only while it holds something. Reading left to right explains the pipeline without
              a word of documentation. */}
          <ol className="flex items-center gap-1">
            {STEPS.map((label, i) => {
              const count = [stats.queued, stats.uploading, processing, stats.completed][i];
              const active = count > 0;
              return (
                <li key={label} className="flex min-w-0 flex-1 items-center gap-1">
                  <span
                    className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                      active ? (i === 3 ? 'bg-studio' : 'bg-studio/70') : 'bg-border'
                    }`}
                    aria-hidden
                  />
                  <span
                    className={`flex-none text-[9px] font-medium tabular-nums transition-colors duration-300 ${
                      active ? 'text-foreground' : 'text-muted-foreground/50'
                    }`}
                  >
                    {label}
                    {active ? ` ${count}` : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {celebrate > 0 && !busy && (
        <p className="animate-scale-in flex items-center gap-1.5 text-[11px] font-medium text-studio">
          <Check className="h-3.5 w-3.5" />
          {celebrate} photo{celebrate === 1 ? '' : 's'} ready
        </p>
      )}

      {/* FAILURES, SEPARATED BY CAUSE. An upload that didn't reach us can be retried from the
          tile; a photo the processor couldn't read needs a different file. Conflating them would
          send half of these users to a button that cannot help them. */}
      {failedUploads > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <AlertTriangle className="mt-px h-3 w-3 flex-none text-destructive" />
          <span>
            <span className="font-medium text-foreground">
              {failedUploads} upload{failedUploads === 1 ? '' : 's'} didn’t finish.
            </span>{' '}
            Retry {failedUploads === 1 ? 'it' : 'them'} from the tray — nothing else is affected.
          </span>
        </p>
      )}
      {rejectedPhotos > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <AlertTriangle className="mt-px h-3 w-3 flex-none text-warning" />
          <span>
            <span className="font-medium text-foreground">
              {rejectedPhotos} photo{rejectedPhotos === 1 ? '' : 's'} couldn’t be read.
            </span>{' '}
            The file may be damaged — remove {rejectedPhotos === 1 ? 'it' : 'them'} and add {rejectedPhotos === 1 ? 'another' : 'others'}.
          </span>
        </p>
      )}
    </div>
  );
}
