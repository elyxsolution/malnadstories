'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { UploadSessionSummary, UploadStats } from '@/lib/uploads';

/**
 * THE upload status strip — ONE line for the whole batch.
 *
 * WHAT THIS USED TO BE. A four-dot stepper (Queued → Uploading → Processing → Ready) with live
 * counts under each, plus an escalating sentence on a 5-second clock. It was an accurate picture
 * of the pipeline and the wrong thing to show: it turned a background process into something to
 * watch, and it named internal stages ("Processing", "Enhancing") that mean nothing to a
 * photographer and can't be acted on.
 *
 * WHAT IT IS NOW. One sentence, one hairline bar, and only while a batch is actually moving:
 *
 *     Uploading 12 of 40                                    30%
 *     ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░
 *
 * Failures keep their own lines, because those are the only states that need a decision — and
 * they stay SEPARATED BY CAUSE, since an upload that never arrived can be retried from the tile
 * while a file the processor couldn't read needs a different file. Conflating them would send
 * half of these users to a button that cannot help them.
 *
 * When there is nothing to report it renders nothing at all, so the rail is not permanently
 * taller — and the completion tick retires itself rather than needing to be dismissed.
 *
 * The upload architecture is untouched: this component still reads the same `UploadStats` and
 * session summaries it always did. Only the presentation got quieter.
 */

export default function SessionStatus({
  stats,
  activeSessions,
  /** Photos confirmed on the server and waiting on the worker (includes page-load hydration). */
  processing,
  failedUploads,
  rejectedPhotos,
}: {
  stats: UploadStats;
  activeSessions: UploadSessionSummary[];
  processing: number;
  failedUploads: number;
  rejectedPhotos: number;
}) {
  const busy = stats.queued > 0 || stats.uploading > 0 || processing > 0;

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

  // ── the one line ───────────────────────────────────────────────────────────────
  // With a live batch, speak in "n of m" — the number people actually track. Without one, say
  // how many are still coming in. Never name the stage they are in.
  const batch = activeSessions[activeSessions.length - 1];
  const batchDone = batch ? batch.completed + batch.failed + batch.cancelled + batch.processing : 0;
  const remaining = stats.queued + stats.uploading + processing;
  const headline = !busy
    ? null
    : batch && batch.total > 1
      ? `Uploading ${Math.min(batchDone + 1, batch.total)} of ${batch.total}`
      : `Uploading ${remaining} photo${remaining === 1 ? '' : 's'}`;

  // Progress comes from the batch when there is one. Otherwise the bar is omitted rather than
  // faked — an indeterminate bar pretending to be determinate is worse than no bar.
  const progress = batch && batch.total > 1 ? Math.round(batch.progress * 100) : null;

  return (
    <div aria-live="polite" className="mt-2 space-y-1.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 ring-1 ring-border/60">
      {busy && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] font-medium leading-tight text-foreground">{headline}</p>
            {progress !== null && <span className="flex-none text-[10px] tabular-nums text-muted-foreground">{progress}%</span>}
          </div>
          {progress !== null && (
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-border/70">
              <div
                className="h-full rounded-full bg-studio transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </>
      )}

      {celebrate > 0 && !busy && (
        <p className="animate-scale-in flex items-center gap-1.5 text-[11px] font-medium text-studio">
          <Check className="h-3.5 w-3.5" />
          {celebrate} photo{celebrate === 1 ? '' : 's'} ready
        </p>
      )}

      {failedUploads > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] leading-tight text-muted-foreground">
          <AlertTriangle className="mt-px h-3 w-3 flex-none text-destructive" />
          <span>
            <span className="font-medium text-foreground">
              {failedUploads} upload{failedUploads === 1 ? '' : 's'} didn’t finish.
            </span>{' '}
            Retry {failedUploads === 1 ? 'it' : 'them'} from the tray.
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
            Replace {rejectedPhotos === 1 ? 'it' : 'them'} with {rejectedPhotos === 1 ? 'another file' : 'other files'}.
          </span>
        </p>
      )}
    </div>
  );
}
