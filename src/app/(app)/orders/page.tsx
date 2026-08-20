import Link from 'next/link';
import { ArrowRight, Check, Package, RotateCcw, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fulfillmentProgress, isPaidStatus, orderStatusView } from '@/lib/orders/status';
import { Button } from '@/components/ui/button';
import { LUX_PRIMARY } from '@/components/brand';
import CustomerShell from '@/components/customer-shell';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

type OrderRow = {
  id: string;
  album_id: string;
  status: string;
  total_amount: string;
  placed_at: string;
};

/**
 * Orders view (Design Completion Phase 1). The prototype's "On their way to you" — the
 * user's orders with crafted-stage progress, a delivered shelf, and pending checkouts.
 * Reuses the existing `orders` table (RLS-scoped) + the status label/timeline SoT. No
 * new entity; the order page (orders/[id]) is the per-order detail.
 */
export default async function OrdersPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, album_id, status, total_amount, placed_at')
    .order('placed_at', { ascending: false });
  const orders = (orderRows ?? []) as OrderRow[];

  // WHAT EACH ORDER CONTAINS, from `order_items` (Phase 8) — an order can hold several albums,
  // so the label is built per ORDER rather than by looking up `orders.album_id`. One batched
  // read, no N+1; the titles are the ones snapshotted at purchase, so a later rename never
  // rewrites an old order. RLS scopes the read through the parent orders.
  const labels = new Map<string, string>();
  if (orders.length > 0) {
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('order_id, album_title, created_at')
      .in(
        'order_id',
        orders.map((o) => o.id),
      )
      .order('created_at', { ascending: true });
    const byOrder = new Map<string, string[]>();
    for (const r of (itemRows ?? []) as { order_id: string; album_title: string }[]) {
      const list = byOrder.get(r.order_id) ?? [];
      list.push(r.album_title);
      byOrder.set(r.order_id, list);
    }
    byOrder.forEach((list, orderId) => {
      labels.set(orderId, list.length === 1 ? list[0] : `${list[0]} + ${list.length - 1} more`);
    });
  }

  const active = orders.filter((o) => isPaidStatus(o.status) && o.status !== 'delivered');
  const delivered = orders.filter((o) => o.status === 'delivered');
  const pending = orders.filter((o) => o.status === 'pending');

  const hasAny = active.length + delivered.length + pending.length > 0;

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="mx-auto max-w-3xl px-5 py-9 sm:px-8">
        <div className="animate-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Orders</p>
          <h1 className="mt-2 font-display text-[2.4rem] font-semibold leading-none tracking-tight">On their way to you.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Each album is printed and hand-bound to order — here’s where yours are in the making.
          </p>

          {!hasAny && (
            <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
                <Package className="h-6 w-6" />
              </span>
              <p className="mt-4 font-display text-xl font-semibold tracking-tight">No orders yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                When you order an album, you’ll be able to follow it from press to doorstep here.
              </p>
              <Button render={<Link href="/dashboard" />} className={`mt-6 ${LUX_PRIMARY}`}>
                Go to your stories
              </Button>
            </div>
          )}

          {/* Pending checkouts */}
          {pending.length > 0 && (
            <div className="mt-8 space-y-3">
              {pending.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/[0.06] px-5 py-4"
                >
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="h-5 w-5 text-warning" />
                    <div>
                      <p className="font-medium">{labels.get(o.id) ?? 'Your album'}</p>
                      <p className="text-xs text-muted-foreground">Awaiting payment · {inr(Number(o.total_amount))}</p>
                    </div>
                  </div>
                  <Button size="sm" render={<Link href={`/orders/${o.id}`} />} className={LUX_PRIMARY}>
                    Complete payment <ArrowRight />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Active orders with crafted-stage progress */}
          {active.length > 0 && (
            <div className="mt-8 space-y-5">
              {active.map((o) => {
                const steps = fulfillmentProgress(o.status);
                const view = orderStatusView(o.status);
                return (
                  <div key={o.id} className="overflow-hidden rounded-2xl border bg-card shadow-panel">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-lg font-semibold tracking-tight">
                            {labels.get(o.id) ?? 'Your album'}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Ordered {fmtDate(o.placed_at)}</p>
                      </div>
                      <span className="rounded-full bg-warning/12 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
                        {view.label}
                      </span>
                    </div>
                    <div className="px-5 py-4">
                      {/* compact stage rail */}
                      <div className="flex items-center">
                        {steps.map((s, i) => (
                          <div key={s.status} className="flex flex-1 items-center last:flex-none">
                            <span
                              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-[11px] ${
                                s.state === 'done'
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : s.state === 'current'
                                    ? 'border-primary bg-card text-primary'
                                    : 'border-border bg-card text-muted-foreground'
                              }`}
                            >
                              {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                            </span>
                            {i < steps.length - 1 && (
                              <span className={`h-0.5 flex-1 ${s.state === 'done' ? 'bg-primary' : 'bg-border'}`} />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="max-w-[44ch] text-sm text-muted-foreground">{view.message}</p>
                        <Button size="sm" variant="outline" render={<Link href={`/orders/${o.id}`} />}>
                          Full timeline <ArrowRight />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Delivered */}
          {delivered.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Delivered</h2>
              <div className="mt-3 space-y-2">
                {delivered.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                        <Check className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-display text-base font-semibold tracking-tight">
                          {labels.get(o.id) ?? 'Your album'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Delivered · {fmtDate(o.placed_at)} · #{o.id.slice(0, 8)}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" render={<Link href={`/orders/${o.id}`} />}>
                      <RotateCcw /> View
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}
