'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { StickyNote } from 'lucide-react';
import { setRefundStatus, setReprintStatus, addRefundNote, addReprintNote } from '@/lib/actions/admin/resolutions';
import { allowedNextStatuses, type RequestStatus } from '@/lib/resolutions/model';

const ACTION_LABEL: Record<RequestStatus, string> = {
  pending: 'Reopen',
  under_review: 'Mark under review',
  approved: 'Approve',
  rejected: 'Reject',
  completed: 'Complete',
};

const ACTION_STYLE: Partial<Record<RequestStatus, string>> = {
  approved: 'bg-primary text-primary-foreground hover:bg-primary/90',
  completed: 'bg-success/15 text-success hover:bg-success/25',
  rejected: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
};

/**
 * Admin decision controls for one refund/reprint request. Renders only the transitions
 * the state machine permits (the RPC re-validates). RECORDS DECISIONS ONLY — approving
 * or completing never calls Razorpay or changes the order. Notes are stored + audited.
 */
export default function RequestActions({
  kind,
  requestId,
  status,
}: {
  kind: 'refund' | 'reprint';
  requestId: string;
  status: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | string>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const setStatus = kind === 'refund' ? setRefundStatus : setReprintStatus;
  const addNote = kind === 'refund' ? addRefundNote : addReprintNote;
  const next = allowedNextStatuses(status);

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

  const decide = (s: RequestStatus) =>
    run(`status-${s}`, () => setStatus({ requestId, status: s, note: note.trim() || undefined }));
  const saveNote = () => run('note', () => addNote({ requestId, note }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin note</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Internal note — attached to a decision, or saved on its own…"
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
          {busy === 'note' ? <InlineLoader /> : <StickyNote className="h-4 w-4" />} Save note
        </button>
      </div>

      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Decision</p>
        {next.length === 0 ? (
          <p className="text-sm text-muted-foreground">This request is closed — no further actions.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {next.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => decide(s)}
                disabled={busy !== null}
                className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                  ACTION_STYLE[s] ?? 'border hover:bg-muted'
                }`}
              >
                {busy === `status-${s}` && <InlineLoader />}
                {ACTION_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Records the decision only — no payment or Razorpay action is taken.
        </p>
      </div>

      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}
