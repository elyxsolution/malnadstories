'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { XCircle, Loader2, LayoutDashboard, Image as ImageIcon, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelOrder } from '@/lib/actions/orders';
import { SealMedallion, LUX_PRIMARY } from '@/components/brand';
import { fulfillmentProgress, isFulfilmentActive, orderStatusView } from '@/lib/orders/status';

type Status = 'pending' | 'paid' | 'failed' | 'cancelled' | string;

/**
 * Confirmation + tracking status block. While the order can still advance
 * (pending → paid → … → shipped) it polls GET /api/orders/:id so the webhook's flip
 * to "paid" and any later admin fulfilment moves show without a reload. Every label
 * comes from lib/orders/status.ts — no status is hardcoded or invented here.
 */
export default function OrderStatus({
  orderId,
  albumId,
  initialStatus,
}: {
  orderId: string;
  albumId: string;
  initialStatus: Status;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [cancelling, setCancelling] = useState(false);

  // Poll while the order is non-terminal: pending (awaiting the webhook) OR a
  // fulfilment state that can still advance. Stops at delivered/failed/cancelled.
  useEffect(() => {
    if (!isFulfilmentActive(status)) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) return;
        const body = (await res.json()) as { status: Status };
        if (active && body.status !== status) {
          setStatus(body.status);
          router.refresh();
        }
      } catch {
        // transient — retry next tick
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [status, orderId, router]);

  const abandon = async () => {
    setCancelling(true);
    const res = await cancelOrder({ orderId });
    setCancelling(false);
    if (res.ok) router.push('/dashboard');
  };

  // ── Paid family (paid → delivered): confirmation seal + live fulfilment timeline ──
  if (
    status === 'paid' ||
    status === 'processing' ||
    status === 'printing' ||
    status === 'packed' ||
    status === 'shipped' ||
    status === 'delivered'
  ) {
    const view = orderStatusView(status);
    const steps = fulfillmentProgress(status);
    const delivered = status === 'delivered';

    return (
      <div className="animate-rise space-y-4">
        {/* Confirmation header */}
        <div className="flex flex-col items-center overflow-hidden rounded-2xl border bg-card px-6 py-9 text-center shadow-panel">
          <SealMedallion className="animate-scale-in" />
          <h2 className="mt-5 font-display text-[1.7rem] font-semibold tracking-tight">
            {delivered ? 'Delivered — we hope you treasure it' : 'Your order is confirmed'}
          </h2>
          <p className="mt-2 max-w-sm text-pretty text-sm text-muted-foreground">{view.message}</p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button render={<Link href={`/albums/${albumId}/build`} />} className={`w-full sm:w-auto ${LUX_PRIMARY}`}>
              <ImageIcon /> View your album
            </Button>
            <Button variant="outline" render={<Link href="/dashboard" />} className="w-full sm:w-auto">
              <LayoutDashboard /> Go to dashboard
            </Button>
          </div>
        </div>

        {/* Live fulfilment timeline — projection of the real orders.status */}
        <div className="rounded-2xl border bg-card p-6 shadow-panel">
          <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Being made by hand
          </p>
          <ol className="relative space-y-0">
            {steps.map((step, i) => {
              const last = i === steps.length - 1;
              return (
                <li key={step.status} className="relative flex gap-4 pb-6 last:pb-0">
                  {/* connector */}
                  {!last && (
                    <span
                      aria-hidden
                      className={`absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-0.5 ${
                        step.state === 'done' ? 'bg-primary' : 'bg-border'
                      }`}
                    />
                  )}
                  <span
                    className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors ${
                      step.state === 'done'
                        ? 'border-primary bg-primary text-primary-foreground'
                        : step.state === 'current'
                          ? 'border-primary bg-card text-primary'
                          : 'border-border bg-card text-muted-foreground'
                    }`}
                  >
                    {step.state === 'done' ? (
                      <Check className="h-4 w-4" />
                    ) : step.state === 'current' ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-border" />
                    )}
                  </span>
                  <div className="pt-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-display text-[15px] font-semibold tracking-tight ${
                          step.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground'
                        }`}
                      >
                        {step.label}
                      </span>
                      {step.state === 'current' && (
                        <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                          In progress
                        </span>
                      )}
                    </div>
                    {step.state !== 'upcoming' && (
                      <p className="mt-0.5 max-w-[46ch] text-xs leading-relaxed text-muted-foreground">
                        {step.message}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    );
  }

  if (status === 'failed' || status === 'cancelled') {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 shadow-panel">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold tracking-tight text-destructive">
              {status === 'failed' ? 'Payment didn’t go through' : 'Checkout cancelled'}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {status === 'failed'
                ? 'No charge was made and your album is safe. You can try again whenever you’re ready.'
                : 'No charge was made. Your album is saved — start again any time.'}
            </p>
          </div>
        </div>
        <Button render={<Link href={`/checkout/${albumId}`} />} className={`mt-4 ${LUX_PRIMARY}`}>
          Try again
        </Button>
      </div>
    );
  }

  // pending
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-panel">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </span>
        <div>
          <p className="font-display text-base font-semibold tracking-tight">Confirming your payment…</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            This page updates on its own the moment your payment clears — no need to refresh.
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">Closed the payment window?</p>
        <Button variant="ghost" size="sm" onClick={abandon} disabled={cancelling}>
          {cancelling ? <Loader2 className="animate-spin" /> : null} Cancel order
        </Button>
      </div>
    </div>
  );
}
