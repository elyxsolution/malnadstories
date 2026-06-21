'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, StickyNote, Check, MessageSquareWarning, X } from 'lucide-react';
import { setAlbumReviewStatus, addAlbumReviewNote } from '@/lib/actions/admin/reviews';
import { allowedNextReviewStatuses, type ReviewStatus } from '@/lib/reviews/model';

const ACTION_LABEL: Record<ReviewStatus, string> = {
  pending_review: 'Reopen',
  approved: 'Approve',
  changes_requested: 'Request changes',
  rejected: 'Reject',
};

const ACTION_ICON: Partial<Record<ReviewStatus, typeof Check>> = {
  approved: Check,
  changes_requested: MessageSquareWarning,
  rejected: X,
};

const ACTION_STYLE: Partial<Record<ReviewStatus, string>> = {
  approved: 'bg-primary text-primary-foreground hover:bg-primary/90',
  changes_requested: 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25',
  rejected: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
};

/**
 * Admin decision controls for one album review. Renders only the transitions the state
 * machine permits (the RPC re-validates). RECORDS THE REVIEW DECISION ONLY — approving or
 * requesting changes never calls Razorpay, generates a PDF, or changes the order/album
 * lifecycle. "Request changes" requires the notes (they become the customer's instructions).
 */
export default function ReviewActions({ reviewId, status }: { reviewId: string; status: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | string>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const next = allowedNextReviewStatuses(status);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setNote('');
      router.refresh();
    } else {
      setMsg(res.error ?? 'Something went wrong.');
    }
  };

  const decide = (s: ReviewStatus) =>
    run(`status-${s}`, () => setAlbumReviewStatus({ reviewId, status: s, notes: note.trim() || undefined }));
  const saveNote = () => run('note', () => addAlbumReviewNote({ reviewId, note }));

  const needsNote = note.trim().length < 10;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note to customer</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Shared with the customer — required when requesting changes (describe what to fix)…"
          rows={4}
          maxLength={2000}
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={saveNote}
          disabled={busy !== null || !note.trim()}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'note' ? <Loader2 className="h-4 w-4 animate-spin" /> : <StickyNote className="h-4 w-4" />} Save note
        </button>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Decision</p>
        {next.length === 0 ? (
          <p className="text-sm text-muted-foreground">This review is closed — no further actions.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {next.map((s) => {
              const Icon = ACTION_ICON[s];
              const disabled = busy !== null || (s === 'changes_requested' && needsNote);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => decide(s)}
                  disabled={disabled}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                    ACTION_STYLE[s] ?? 'border hover:bg-muted'
                  }`}
                >
                  {busy === `status-${s}` ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
                  {ACTION_LABEL[s]}
                </button>
              );
            })}
          </div>
        )}
        {next.includes('changes_requested') && needsNote && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Add a note (≥ 10 chars) above to request changes — it becomes the customer’s to-do list.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Records the review decision only — no payment, PDF, or fulfilment action is taken.
        </p>
      </div>

      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}
