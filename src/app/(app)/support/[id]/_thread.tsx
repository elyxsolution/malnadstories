'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, BookImage, Package, CheckCircle2 } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import { Button } from '@/components/ui/button';
import { replyToTicket } from '@/lib/actions/support';
import { categoryLabel, statusLabel, statusChip } from '@/lib/support/model';

export type ThreadMessage = {
  id: string;
  sender_type: string;
  body: string;
  created_at: string;
};

type Ticket = {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  albumId: string | null;
  orderId: string | null;
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Thread({ ticket, messages }: { ticket: Ticket; messages: ThreadMessage[] }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = ticket.status === 'closed';
  const resolved = ticket.status === 'resolved';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    const res = await replyToTicket({ ticketId: ticket.id, body });
    if (res.ok) {
      setBody('');
      router.refresh();
    } else {
      setError(res.error);
    }
    setBusy(false);
  };

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Support
        </Link>

        {/* Header */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusChip(ticket.status)}`}>
            {statusLabel(ticket.status)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {categoryLabel(ticket.category)}
          </span>
          <span className="text-[12px] text-muted-foreground">#{ticket.id.slice(0, 8)}</span>
        </div>
        <h1 className="mt-2 font-display text-[2rem] font-normal leading-tight tracking-tight text-primary">
          {ticket.subject}
        </h1>

        {(ticket.albumId || ticket.orderId) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ticket.albumId && (
              <Link
                href={`/albums/${ticket.albumId}`}
                className="inline-flex items-center gap-1.5 border border-input bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-primary"
              >
                <BookImage className="h-3.5 w-3.5 text-gold" /> Related album
              </Link>
            )}
            {ticket.orderId && (
              <Link
                href={`/orders/${ticket.orderId}`}
                className="inline-flex items-center gap-1.5 border border-input bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-primary"
              >
                <Package className="h-3.5 w-3.5 text-gold" /> Order #{ticket.orderId.slice(0, 8)}
              </Link>
            )}
          </div>
        )}

        {/* Conversation */}
        <div className="mt-9 space-y-5">
          <Bubble side="customer" time={fmtTime(ticket.createdAt)}>
            {ticket.description}
          </Bubble>
          {messages.map((m) => (
            <Bubble key={m.id} side={m.sender_type === 'admin' ? 'admin' : 'customer'} time={fmtTime(m.created_at)}>
              {m.body}
            </Bubble>
          ))}
        </div>

        {/* Reply / status */}
        <div className="mt-9 border-t border-border pt-6">
          {closed ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" />
              This request is closed. Need more help?{' '}
              <Link href="/support/new" className="text-primary underline-offset-2 hover:underline">
                Open a new request
              </Link>
              .
            </div>
          ) : (
            <form onSubmit={submit}>
              {resolved && (
                <p className="mb-3 text-[13px] text-muted-foreground">
                  Marked resolved — replying will reopen this request.
                </p>
              )}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write a reply…"
                rows={4}
                maxLength={4000}
                className="w-full resize-y border border-input bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-primary"
              />
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              <div className="mt-3 flex justify-end">
                <Button type="submit" disabled={busy || !body.trim()}>
                  {busy ? <InlineLoader /> : <Send />} Send reply
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  time,
  children,
}: {
  side: 'customer' | 'admin';
  time: string;
  children: React.ReactNode;
}) {
  const isAdmin = side === 'admin';
  return (
    <div className={`flex flex-col ${isAdmin ? 'items-start' : 'items-end'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed ${
          isAdmin
            ? 'rounded-[2px] border border-border bg-card text-foreground'
            : 'rounded-[2px] bg-primary text-primary-foreground'
        }`}
      >
        {children}
      </div>
      <span className="mt-1 px-1 text-[11px] text-muted-foreground">
        {isAdmin ? 'Malnad Stories' : 'You'} · {time}
      </span>
    </div>
  );
}
