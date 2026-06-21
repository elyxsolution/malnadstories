import Link from 'next/link';
import { ArrowLeft, Package, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { statusLabel, statusChip, type RequestStatus } from '@/lib/resolutions/model';

export type RequestView = {
  kind: 'refund' | 'reprint';
  id: string;
  detailLabel: string; // reason / issue label
  description: string;
  orderId: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// The happy path the customer can expect. 'rejected' is shown as a terminal off-ramp.
const STEPS: RequestStatus[] = ['pending', 'under_review', 'approved', 'completed'];

/**
 * Read-only status view for a customer's refund/reprint request. Customers cannot modify
 * a request after submission (no UPDATE grant); this surfaces status + their submission.
 * admin_notes / resolved_by are never fetched or shown (column-scoped grant).
 */
export default function RequestStatusView({ view }: { view: RequestView }) {
  const isRefund = view.kind === 'refund';
  const rejected = view.status === 'rejected';
  const currentIdx = STEPS.indexOf(view.status as RequestStatus);

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/support/requests"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Refunds &amp; reprints
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusChip(view.status)}`}>
            {statusLabel(view.status)}
          </span>
          <span className="text-[12px] text-muted-foreground">#{view.id.slice(0, 8)}</span>
        </div>
        <h1 className="mt-2 font-display text-[2rem] font-normal leading-tight tracking-tight text-primary">
          {isRefund ? 'Refund' : 'Reprint'} — {view.detailLabel}
        </h1>

        <Link
          href={`/orders/${view.orderId}`}
          className="mt-3 inline-flex items-center gap-1.5 border border-input bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-primary"
        >
          <Package className="h-3.5 w-3.5 text-gold" /> Order #{view.orderId.slice(0, 8)}
        </Link>

        {/* Progress */}
        <div className="mt-8 border border-border bg-card p-5">
          {rejected ? (
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">This request was not approved</p>
                <p className="text-[13px] text-muted-foreground">
                  Reply to your support thread if you’d like to discuss it further.
                </p>
              </div>
            </div>
          ) : (
            <ol className="space-y-3">
              {STEPS.map((s, i) => {
                const done = currentIdx >= 0 && i <= currentIdx;
                const current = i === currentIdx;
                return (
                  <li key={s} className="flex items-center gap-3">
                    {done ? (
                      <CheckCircle2 className={`h-5 w-5 ${current ? 'text-primary' : 'text-success'}`} />
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground/40" />
                    )}
                    <span className={`text-sm ${done ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                      {statusLabel(s)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Submission */}
        <div className="mt-6">
          <h2 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Your message</h2>
          <p className="mt-2 whitespace-pre-wrap rounded-[2px] border border-border bg-muted/20 p-4 text-sm leading-relaxed">
            {view.description}
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Submitted {fmt(view.createdAt)}
            {view.resolvedAt ? ` · Updated ${fmt(view.resolvedAt)}` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
