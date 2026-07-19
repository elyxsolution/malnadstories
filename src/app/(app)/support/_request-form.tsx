'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createRefundRequest, createReprintRequest } from '@/lib/actions/resolutions';

export type Option = { value: string; label: string };
export type LinkRow = { id: string; label: string };

const fieldClass =
  'w-full border border-input bg-card px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary';

/**
 * Shared create-form for refund + reprint requests. Picks the right server action by
 * `kind`; the action + RLS re-verify order ownership, eligibility and ticket ownership.
 */
export default function RequestForm({
  kind,
  detailLabel,
  options,
  orders,
  tickets,
  presetOrderId,
}: {
  kind: 'refund' | 'reprint';
  detailLabel: string;
  options: Option[];
  orders: LinkRow[];
  tickets: LinkRow[];
  presetOrderId: string | null;
}) {
  const router = useRouter();
  const isRefund = kind === 'refund';
  const [orderId, setOrderId] = useState(presetOrderId && orders.some((o) => o.id === presetOrderId) ? presetOrderId : '');
  const [detail, setDetail] = useState(options[0]?.value ?? '');
  const [description, setDescription] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noOrders = orders.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !orderId) return;
    setBusy(true);
    setError(null);
    const res = isRefund
      ? await createRefundRequest({ orderId, reason: detail, description, supportTicketId: ticketId || undefined })
      : await createReprintRequest({ orderId, issueType: detail, description, supportTicketId: ticketId || undefined });
    if (res.ok) {
      router.push(`/support/${isRefund ? 'refunds' : 'reprints'}/${res.id}`);
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/support/requests"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Refunds &amp; reprints
        </Link>

        <h1 className="mt-4 font-display text-[2.4rem] font-normal leading-none tracking-tight text-primary">
          {isRefund ? 'Request a refund' : 'Request a reprint'}
        </h1>
        <p className="mt-3 text-sm font-light text-muted-foreground">
          {isRefund
            ? 'Refunds apply to paid orders. We’ll review your request and reply by email.'
            : 'Reprints apply to delivered orders. Tell us what went wrong and we’ll review it.'}
        </p>

        {noOrders ? (
          <div className="mt-9 border border-dashed bg-card/40 px-6 py-12 text-center">
            <p className="font-display text-xl text-primary">No eligible orders</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isRefund
                ? 'You don’t have a paid order to request a refund for yet.'
                : 'You don’t have a delivered order to request a reprint for yet.'}
            </p>
            <Button variant="outline" render={<Link href="/support/requests" />} className="mt-5">
              Back to requests
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-9 space-y-6">
            <Field label="Which order?">
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} required className={fieldClass}>
                <option value="">Select an order…</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={detailLabel}>
              <select value={detail} onChange={(e) => setDetail(e.target.value)} className={fieldClass}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="What happened?">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Share the details — photos help over email too."
                rows={6}
                maxLength={4000}
                required
                className={`${fieldClass} resize-y leading-relaxed`}
              />
            </Field>

            {tickets.length > 0 && (
              <Field label="Link a support ticket (optional)">
                <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} className={fieldClass}>
                  <option value="">None</option>
                  {tickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {error && (
              <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
              <Button variant="ghost" render={<Link href="/support/requests" />} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !orderId}>
                {busy ? <InlineLoader /> : <Send />} Submit request
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
