'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle, Loader2, LayoutDashboard, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelOrder } from '@/lib/actions/orders';

type Status = 'pending' | 'paid' | 'failed' | 'cancelled' | string;

/**
 * Confirmation-page status block. While the order is pending, polls
 * GET /api/orders/:id so the webhook's flip to "paid" shows without a reload, and
 * offers a cancel escape. Fulfillment is webhook-driven — this only reflects it.
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

  useEffect(() => {
    if (status !== 'pending') return;
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

  if (status === 'paid') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <div>
            <p className="font-medium text-primary">Payment confirmed</p>
            <p className="text-muted-foreground">Thank you! We&apos;ve received your order.</p>
          </div>
        </div>
        {/* Clear next steps. Real links (Button render={<Link/>}) → keyboard- and
            screen-reader-accessible; full-width stacked on mobile, inline on ≥sm. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button render={<Link href="/dashboard" />} className="w-full sm:w-auto">
            <LayoutDashboard /> Go to Dashboard
          </Button>
          <Button
            variant="outline"
            render={<Link href={`/albums/${albumId}/build`} />}
            className="w-full sm:w-auto"
          >
            <ImageIcon /> View Album
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'failed' || status === 'cancelled') {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <div className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-destructive" />
          <p className="font-medium text-destructive">
            {status === 'failed' ? 'Payment failed' : 'Order cancelled'}
          </p>
        </div>
        <p className="text-muted-foreground">
          {status === 'failed'
            ? 'Your payment didn’t go through. You can try again.'
            : 'This checkout was cancelled. You can start again any time.'}
        </p>
        <Button render={<Link href={`/checkout/${albumId}`} />} size="sm">
          Try again
        </Button>
      </div>
    );
  }

  // pending
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <p className="font-medium">Awaiting payment confirmation…</p>
      </div>
      <p className="text-muted-foreground">
        This updates automatically once your payment is confirmed. If you closed the
        payment window, you can cancel this checkout.
      </p>
      <Button variant="ghost" size="sm" onClick={abandon} disabled={cancelling}>
        {cancelling ? <Loader2 className="animate-spin" /> : null} Cancel order
      </Button>
    </div>
  );
}
