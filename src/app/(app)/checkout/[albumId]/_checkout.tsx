'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { Loader2, CreditCard, X, ArrowLeft, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOrder, cancelOrder, previewCoupon, previewOrderAmount } from '@/lib/actions/orders';
import AddressPicker, { type Address } from './_address-picker';

type AmountBreakdown = {
  subtotalInr: number;
  shippingInr: number;
  discountInr: number;
  totalInr: number;
};

// Minimal shape of the Razorpay Checkout global (loaded from checkout.js).
type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler?: (r: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
};
type RazorpayInstance = { open: () => void };
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const MAX_COPIES = 10;

type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'processing' | 'shipped' | 'delivered';
const PAID_STATES = ['paid', 'processing', 'shipped', 'delivered'];

export default function Checkout({
  albumId,
  albumTitle,
  amount,
  addresses,
  pendingOrderId,
  initialCopies,
  initialCouponCode,
}: {
  albumId: string;
  albumTitle: string;
  amount: AmountBreakdown;
  addresses: Address[];
  pendingOrderId: string | null;
  initialCopies: number;
  initialCouponCode: string | null;
}) {
  const router = useRouter();
  const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
  const [selectedId, setSelectedId] = useState<string | null>(defaultAddr?.id ?? null);
  const [scriptReady, setScriptReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const payInFlight = useRef(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(pendingOrderId);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(pendingOrderId ? 'pending' : null);
  const [error, setError] = useState<string | null>(null);

  // ── Copies + coupon (all amounts come from the SERVER; the client only holds the
  // selections and renders the server-returned breakdown). ───────────────────────────
  const [copies, setCopies] = useState(initialCopies);
  const [breakdown, setBreakdown] = useState<AmountBreakdown>(amount);
  const [couponInput, setCouponInput] = useState(initialCouponCode ?? '');
  const [appliedCode, setAppliedCode] = useState<string | null>(initialCouponCode);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);

  const busyControls = paying || pricingBusy || couponBusy;

  // Poll the active order's status while pending (webhook-driven). Paid → confirmation.
  useEffect(() => {
    if (!activeOrderId) return;
    if (orderStatus && orderStatus !== 'pending') return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${activeOrderId}`);
        if (!res.ok || !active) return;
        const body = (await res.json()) as { status: OrderStatus };
        if (!active || body.status === orderStatus) return;
        setOrderStatus(body.status);
        if (PAID_STATES.includes(body.status)) router.push(`/orders/${activeOrderId}`);
      } catch {
        // transient — retry next tick
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [activeOrderId, orderStatus, router]);

  // Server-priced recompute. With a code → previewCoupon (re-validates min-order etc.
  // at the new copy count); without → previewOrderAmount. If a previously-applied coupon
  // no longer validates (e.g. copies dropped below its minimum), it is dropped and the
  // un-discounted price is shown with a message.
  const recompute = async (nextCopies: number, code: string | null) => {
    setPricingBusy(true);
    if (code) {
      const res = await previewCoupon({ albumId, copies: nextCopies, code });
      if (res.ok) {
        setBreakdown({
          subtotalInr: res.subtotalInr,
          shippingInr: res.shippingInr,
          discountInr: res.discountInr,
          totalInr: res.totalInr,
        });
        setAppliedCode(res.code);
        setCouponError(null);
      } else {
        setAppliedCode(null);
        setCouponError(`${res.error} Coupon removed.`);
        const p = await previewOrderAmount({ albumId, copies: nextCopies });
        if (p.ok) setBreakdown({ subtotalInr: p.subtotalInr, shippingInr: p.shippingInr, discountInr: 0, totalInr: p.totalInr });
      }
    } else {
      const p = await previewOrderAmount({ albumId, copies: nextCopies });
      if (p.ok) setBreakdown({ subtotalInr: p.subtotalInr, shippingInr: p.shippingInr, discountInr: 0, totalInr: p.totalInr });
      else setError(p.error);
    }
    setPricingBusy(false);
  };

  const changeCopies = (delta: number) => {
    const next = Math.min(MAX_COPIES, Math.max(1, copies + delta));
    if (next === copies || busyControls) return;
    setCopies(next);
    recompute(next, appliedCode);
  };

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    const res = await previewCoupon({ albumId, copies, code });
    setCouponBusy(false);
    if (res.ok) {
      setBreakdown({
        subtotalInr: res.subtotalInr,
        shippingInr: res.shippingInr,
        discountInr: res.discountInr,
        totalInr: res.totalInr,
      });
      setAppliedCode(res.code);
      setCouponInput(res.code);
    } else {
      setCouponError(res.error);
    }
  };

  const removeCoupon = async () => {
    setAppliedCode(null);
    setCouponInput('');
    setCouponError(null);
    await recompute(copies, null);
  };

  const pay = async () => {
    if (!selectedId) {
      setError('Please select a delivery address.');
      return;
    }
    if (!scriptReady || !window.Razorpay) {
      setError('Payment is still loading — please try again in a moment.');
      return;
    }
    if (payInFlight.current) return;
    payInFlight.current = true;
    setPaying(true);
    setError(null);

    // The client sends only ids + copies + the code. createOrder recomputes the amount
    // server-side and re-validates the coupon — a stale/invalid preview cannot underpay.
    const res = await createOrder({
      albumId,
      addressId: selectedId,
      copies,
      couponCode: appliedCode ?? undefined,
    });
    if (!res.ok) {
      payInFlight.current = false;
      setPaying(false);
      setError(res.error);
      return;
    }
    setActiveOrderId(res.orderId);
    setOrderStatus('pending');

    const rzp = new window.Razorpay({
      key: res.keyId,
      amount: res.amountPaise, // server-issued; the client never supplies an amount
      currency: res.currency,
      order_id: res.razorpayOrderId,
      name: 'Malnad Stories',
      description: albumTitle,
      prefill: res.prefill,
      theme: { color: '#0f172a' },
      handler: async (r) => {
        try {
          const v = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(r),
          });
          if (v.ok) {
            router.push(`/orders/${res.orderId}`);
            return;
          }
        } catch {
          // fall through
        }
        payInFlight.current = false;
        setPaying(false);
        setError('We could not verify the payment. If you were charged, it will confirm shortly.');
      },
      modal: {
        ondismiss: () => {
          payInFlight.current = false;
          setPaying(false);
        },
      },
    });
    rzp.open();
  };

  const albumHref = `/albums/${albumId}/build`;

  const cancelCheckout = async () => {
    if (!activeOrderId || orderStatus !== 'pending') {
      router.push(albumHref);
      return;
    }
    setCancelling(true);
    setError(null);
    const res = await cancelOrder({ orderId: activeOrderId });
    setCancelling(false);
    if (res.ok) {
      router.push(albumHref);
    } else {
      setError(res.error);
      setOrderStatus('failed');
    }
  };

  return (
    <div className="space-y-6">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        strategy="afterInteractive"
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Delivery address</h2>
        <AddressPicker addresses={addresses} selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      {/* Coupon */}
      <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-semibold">Coupon</h2>
        {appliedCode ? (
          <div className="flex items-center justify-between">
            <span className="font-mono text-primary">{appliedCode} applied</span>
            <Button variant="ghost" size="sm" onClick={removeCoupon} disabled={paying || pricingBusy}>
              {pricingBusy ? <Loader2 className="animate-spin" /> : null} Remove
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder="MS-XXXXXXXX"
              disabled={paying || couponBusy}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={applyCoupon}
              disabled={paying || couponBusy || !couponInput.trim()}
            >
              {couponBusy ? <Loader2 className="animate-spin" /> : null} Apply
            </Button>
          </div>
        )}
        {couponError && <p className="text-xs text-destructive">{couponError}</p>}
      </section>

      {/* Order summary */}
      <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-semibold">Order summary</h2>

        <div className="flex items-center justify-between">
          <span>Copies</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => changeCopies(-1)}
              disabled={copies <= 1 || busyControls}
              aria-label="Decrease copies"
            >
              <Minus />
            </Button>
            <span className="w-6 text-center font-medium">{copies}</span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => changeCopies(1)}
              disabled={copies >= MAX_COPIES || busyControls}
              aria-label="Increase copies"
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div className="flex justify-between text-muted-foreground">
          <span>
            Album ({albumTitle}) × {copies}
          </span>
          <span>{inr(breakdown.subtotalInr)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping</span>
          <span>{inr(breakdown.shippingInr)}</span>
        </div>
        {breakdown.discountInr > 0 && (
          <div className="flex justify-between text-primary">
            <span>Discount{appliedCode ? ` (${appliedCode})` : ''}</span>
            <span>− {inr(breakdown.discountInr)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span>
            {pricingBusy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : inr(breakdown.totalInr)}
          </span>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {orderStatus === 'failed' ? (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-destructive">Payment failed</p>
          <p className="text-sm text-muted-foreground">
            Your payment didn’t go through. You can try again.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={pay} disabled={busyControls || !selectedId} className="w-full sm:w-auto">
              {paying ? <Loader2 className="animate-spin" /> : <CreditCard />} Retry payment{' '}
              {inr(breakdown.totalInr)}
            </Button>
            <Button variant="ghost" render={<Link href={albumHref} />} className="w-full sm:w-auto">
              <ArrowLeft /> Back to Album
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button onClick={pay} disabled={busyControls || !selectedId} className="w-full sm:w-auto">
            {paying ? <Loader2 className="animate-spin" /> : <CreditCard />} Pay {inr(breakdown.totalInr)}
          </Button>
          {(orderStatus === null || orderStatus === 'pending') && (
            <Button
              variant="destructive"
              onClick={cancelCheckout}
              disabled={cancelling || paying}
              className="w-full sm:w-auto"
            >
              {cancelling ? <Loader2 className="animate-spin" /> : <X />} Cancel checkout
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
