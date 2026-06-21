import Link from 'next/link';
import { ArrowLeft, ArrowRight, RotateCcw, BadgeIndianRupee } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import { Button } from '@/components/ui/button';
import { statusLabel, statusChip, refundReasonLabel, reprintIssueLabel } from '@/lib/resolutions/model';

type RefundRow = { id: string; order_id: string; reason: string; status: string; created_at: string };
type ReprintRow = { id: string; order_id: string; issue_type: string; status: string; created_at: string };

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Refunds & reprints hub. RLS (customer_id = auth.uid()) scopes both lists to the owner;
 * the column-scoped SELECT grant means admin_notes / resolved_by are never returned here.
 */
export default async function RequestsHubPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [refundsRes, reprintsRes] = await Promise.all([
    supabase
      .from('refund_requests')
      .select('id, order_id, reason, status, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('reprint_requests')
      .select('id, order_id, issue_type, status, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const refunds = (refundsRes.data ?? []) as RefundRow[];
  const reprints = (reprintsRes.data ?? []) as ReprintRow[];

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="px-5 py-9 sm:px-8 lg:py-12">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/support"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Support
          </Link>

          <h1 className="mt-4 font-display text-[2.6rem] font-normal leading-none tracking-tight text-primary">
            Refunds &amp; reprints
          </h1>
          <p className="mt-3 text-base font-light text-muted-foreground">
            Request a refund on a paid order, or a reprint of a delivered album — and track the outcome here.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Button render={<Link href="/support/refunds/new" />}>
              <BadgeIndianRupee /> Request a refund
            </Button>
            <Button variant="outline" render={<Link href="/support/reprints/new" />}>
              <RotateCcw /> Request a reprint
            </Button>
          </div>

          <RequestSection
            title="Refunds"
            empty="No refund requests yet."
            rows={refunds.map((r) => ({
              id: r.id,
              href: `/support/refunds/${r.id}`,
              detail: refundReasonLabel(r.reason),
              orderId: r.order_id,
              status: r.status,
              createdAt: r.created_at,
            }))}
          />
          <RequestSection
            title="Reprints"
            empty="No reprint requests yet."
            rows={reprints.map((r) => ({
              id: r.id,
              href: `/support/reprints/${r.id}`,
              detail: reprintIssueLabel(r.issue_type),
              orderId: r.order_id,
              status: r.status,
              createdAt: r.created_at,
            }))}
          />
        </div>
      </div>
    </CustomerShell>
  );
}

function RequestSection({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: { id: string; href: string; detail: string; orderId: string; status: string; createdAt: string }[];
}) {
  return (
    <section className="mt-11">
      <h2 className="font-display text-2xl font-medium tracking-tight text-primary">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 border border-dashed bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="group flex items-center gap-4 py-4 transition-colors hover:bg-card/60">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChip(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                    <span className="text-[12px] text-muted-foreground">Order #{r.orderId.slice(0, 8)}</span>
                  </div>
                  <p className="mt-1.5 truncate font-display text-lg leading-tight text-primary">{r.detail}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    #{r.id.slice(0, 8)} · {fmt(r.createdAt)}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 flex-none text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
