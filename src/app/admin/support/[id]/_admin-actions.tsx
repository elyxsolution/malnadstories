'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { Send, Lock, UserCheck, UserX } from 'lucide-react';
import { adminReplyTicket, setTicketStatus, assignTicket } from '@/lib/actions/admin/support';
import { SUPPORT_STATUSES, adminStatusLabel, type SupportStatus } from '@/lib/support/model';

export default function SupportActions({
  ticketId,
  status,
  assignedToMe,
  assignedLabel,
}: {
  ticketId: string;
  status: string;
  assignedToMe: boolean;
  assignedLabel: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState<null | 'reply' | 'status' | 'assign'>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (kind: 'reply' | 'status' | 'assign', fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(kind);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      if (kind === 'reply') setBody('');
      router.refresh();
    } else {
      setMsg(res.error ?? 'Something went wrong.');
    }
  };

  const reply = () =>
    run('reply', () => adminReplyTicket({ ticketId, body, internal }));

  const changeStatus = (next: SupportStatus) =>
    run('status', () => setTicketStatus({ ticketId, status: next }));

  const toggleAssign = () =>
    run('assign', () => assignTicket({ ticketId, assign: !assignedToMe }));

  return (
    <div className="space-y-4">
      {/* Reply / internal note */}
      <div className="rounded-lg border bg-card p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={internal ? 'Internal note (customer can’t see this)…' : 'Reply to the customer…'}
          rows={5}
          maxLength={4000}
          className="w-full resize-y rounded-md border bg-background px-2.5 py-2 text-sm outline-none focus:border-ring"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-amber-600" />
          <Lock className="h-3 w-3" /> Internal note (not emailed, hidden from customer)
        </label>
        <button
          type="button"
          onClick={reply}
          disabled={busy !== null || !body.trim()}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === 'reply' ? <InlineLoader /> : <Send className="h-4 w-4" />}
          {internal ? 'Add internal note' : 'Send reply'}
        </button>
      </div>

      {/* Status */}
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Set status</p>
        <div className="flex flex-wrap gap-1.5">
          {SUPPORT_STATUSES.map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => changeStatus(s)}
                disabled={busy !== null || active}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
                  active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {adminStatusLabel(s)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Assignment */}
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Assignment</p>
        <p className="mb-2 text-sm text-muted-foreground">
          {assignedLabel ? `Assigned to ${assignedToMe ? 'you' : assignedLabel}` : 'Unassigned'}
        </p>
        <button
          type="button"
          onClick={toggleAssign}
          disabled={busy !== null}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'assign' ? (
            <InlineLoader />
          ) : assignedToMe ? (
            <UserX className="h-4 w-4" />
          ) : (
            <UserCheck className="h-4 w-4" />
          )}
          {assignedToMe ? 'Unassign me' : 'Assign to me'}
        </button>
      </div>

      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </div>
  );
}
