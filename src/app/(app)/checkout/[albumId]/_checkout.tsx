'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { Loader2, Lock, X, ArrowLeft, Minus, Plus, ShieldCheck, RefreshCw, MapPin, Tag, BookOpen, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOrder, cancelOrder, previewCoupon, previewOrderAmount } from '@/lib/actions/orders';
import { LUX_PRIMARY } from '@/components/brand';
import { SHIPPING_TIERS, type ShippingMethod } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
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

export default function Checkout({
  albumId,
  albumTitle,
  albumSize,
  coverUrl,
  coverName,
  amount,
  addresses,
  pendingOrderId,
  initialCopies,
  initialCouponCode,
  initialShippingMethod,
}: {
  albumId: string;
  albumTitle: string;
  albumSize: number;
  coverUrl: string | null;
  coverName: string | null;
  amount: AmountBreakdown;
  addresses: Address[];
  pendingOrderId: string | null;
  initialCopies: number;
  initialCouponCode: string | null;
  initialShippingMethod: ShippingMethod;
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
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(initialShippingMethod);
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
        if (isPaidStatus(body.status)) router.push(`/orders/${activeOrderId}`);
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

  // Final safety net for the next/script cache case: if the SDK is already present on
  // this render (loaded by a previous mount), mark ready immediately so neither the
  // button gating nor the pay() guard can wedge waiting for an onLoad that won't re-fire.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.Razorpay) setScriptReady(true);
  }, []);

  // Server-priced recompute. With a code → previewCoupon (re-validates min-order etc.
  // at the new copy count); without → previewOrderAmount. If a previously-applied coupon
  // no longer validates (e.g. copies dropped below its minimum), it is dropped and the
  // un-discounted price is shown with a message.
  const recompute = async (nextCopies: number, code: string | null, method: ShippingMethod) => {
    setPricingBusy(true);
    if (code) {
      const res = await previewCoupon({ albumId, copies: nextCopies, shippingMethod: method, code });
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
        const p = await previewOrderAmount({ albumId, copies: nextCopies, shippingMethod: method });
        if (p.ok) setBreakdown({ subtotalInr: p.subtotalInr, shippingInr: p.shippingInr, discountInr: 0, totalInr: p.totalInr });
      }
    } else {
      const p = await previewOrderAmount({ albumId, copies: nextCopies, shippingMethod: method });
      if (p.ok) setBreakdown({ subtotalInr: p.subtotalInr, shippingInr: p.shippingInr, discountInr: 0, totalInr: p.totalInr });
      else setError(p.error);
    }
    setPricingBusy(false);
  };

  const changeCopies = (delta: number) => {
    const next = Math.min(MAX_COPIES, Math.max(1, copies + delta));
    if (next === copies || busyControls) return;
    setCopies(next);
    recompute(next, appliedCode, shippingMethod);
  };

  const changeShipping = (method: ShippingMethod) => {
    if (method === shippingMethod || busyControls) return;
    setShippingMethod(method);
    recompute(copies, appliedCode, method);
  };

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    const res = await previewCoupon({ albumId, copies, shippingMethod, code });
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
    await recompute(copies, null, shippingMethod);
  };

  const pay = async () => {
    if (!selectedId) {
      setError('Please select a delivery address.');
      return;
    }
    // Readiness is derived from the actual SDK (onReady + the mount check above), and the
    // button is disabled until then — so this is now a safety net rather than the thing
    // that strands the flow. Trust window.Razorpay directly, not just the state flag.
    if (typeof window === 'undefined' || !window.Razorpay) {
      setError('Payment is still loading — please try again in a moment.');
      return;
    }
    if (payInFlight.current) return;
    payInFlight.current = true;
    setPaying(true);
    setError(null);

    try {
      // The client sends only ids + copies + the code. createOrder recomputes the amount
      // server-side and re-validates the coupon — a stale/invalid preview cannot underpay.
      const res = await createOrder({
        albumId,
        addressId: selectedId,
        copies,
        shippingMethod,
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
    } catch {
      // createOrder rejected (network/server throw) or Checkout failed to construct/open.
      // Without this, paying/payInFlight stay set and the button is stuck disabled until a
      // refresh. Reset so the user can retry in place. (No finally: on the success path we
      // intentionally KEEP paying=true while the Razorpay modal is open.)
      payInFlight.current = false;
      setPaying(false);
      setError('Something went wrong starting the payment. Please try again.');
    }
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
        strategy="afterInteractive"
        // onReady fires on EVERY mount — including when next/script has already cached
        // the script after a client-side nav back to checkout. onLoad fires only once on
        // the real network load and is SKIPPED on a cached remount, which used to leave
        // scriptReady stuck false (Pay then wedged on "Payment still loading"). Keep both
        // so we're covered regardless; setting the flag twice is harmless.
        onReady={() => setScriptReady(true)}
        onLoad={() => setScriptReady(true)}
        onError={() =>
          setError('Could not load the payment library. Please refresh and try again.')
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_390px]">
        {/* ── Left: the details you provide ─────────────────────────────────── */}
        <div className="space-y-5">
          <section className="rounded-2xl border bg-card/90 p-5 shadow-panel">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-primary">
                <MapPin className="h-4 w-4" />
              </span>
              <h2 className="font-display text-[15px] font-semibold tracking-tight">Where should we send it?</h2>
            </div>
            <AddressPicker addresses={addresses} selectedId={selectedId} onSelect={setSelectedId} />
          </section>

          {/* Delivery tier — fee is server-authoritative (recomputed on select). */}
          <section className="rounded-2xl border bg-card/90 p-5 shadow-panel">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-primary">
                <Truck className="h-4 w-4" />
              </span>
              <h2 className="font-display text-[15px] font-semibold tracking-tight">How soon do you need it?</h2>
            </div>
            <div className="space-y-2">
              {SHIPPING_TIERS.map((t) => {
                const selected = shippingMethod === t.method;
                return (
                  <button
                    key={t.method}
                    type="button"
                    onClick={() => changeShipping(t.method)}
                    disabled={busyControls}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                      selected ? 'border-primary bg-primary/[0.05] ring-1 ring-primary/30' : 'border-border hover:bg-secondary/40'
                    }`}
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                        selected ? 'border-primary' : 'border-muted-foreground/40'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{t.label}</span>
                      <span className="block text-xs text-muted-foreground">{t.window}</span>
                    </span>
                    <span className="font-display text-sm font-semibold tabular-nums">{inr(t.feeInr)}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border bg-card/90 p-5 shadow-panel">
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-primary">
                <Tag className="h-4 w-4" />
              </span>
              <h2 className="font-display text-[15px] font-semibold tracking-tight">Have a coupon?</h2>
            </div>
            {appliedCode ? (
              <div className="flex items-center justify-between rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Tag className="h-3 w-3" />
                  </span>
                  <span className="font-mono font-medium text-primary">{appliedCode}</span>
                  <span className="text-muted-foreground">applied</span>
                </span>
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
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  onClick={applyCoupon}
                  disabled={paying || couponBusy || !couponInput.trim()}
                >
                  {couponBusy ? <Loader2 className="animate-spin" /> : null} Apply
                </Button>
              </div>
            )}
            {couponError && <p className="mt-2 text-xs text-destructive">{couponError}</p>}
          </section>
        </div>

        {/* ── Right: what you're buying + pay (sticky) ──────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="overflow-hidden rounded-2xl border bg-card shadow-panel">
            {/* Album preview — see what you're about to print */}
            <div className="flex gap-4 p-5">
              <div className="relative aspect-[3/4] w-[68px] shrink-0 overflow-hidden rounded-lg bg-muted shadow-paper ring-1 ring-black/10">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt={coverName ?? 'Album cover'} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-muted-foreground/50">
                    <BookOpen className="h-5 w-5" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your album</p>
                <h3 className="mt-0.5 truncate font-display text-lg font-semibold leading-snug tracking-tight">{albumTitle}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {albumSize} printed pages
                  {coverName ? ` · ${coverName} cover` : ''}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  <BookOpen className="h-3 w-3" /> Hardbound keepsake
                </p>
              </div>
            </div>

            <div className="seam mx-5" />

            {/* Copies + price breakdown */}
            <div className="space-y-2.5 p-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Copies</span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => changeCopies(-1)}
                    disabled={copies <= 1 || busyControls}
                    aria-label="Decrease copies"
                  >
                    <Minus />
                  </Button>
                  <span className="w-6 text-center font-medium tabular-nums">{copies}</span>
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
                <span>Album × {copies}</span>
                <span className="tabular-nums text-foreground">{inr(breakdown.subtotalInr)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping · {SHIPPING_TIERS.find((t) => t.method === shippingMethod)?.label ?? 'Standard'}</span>
                <span className="tabular-nums text-foreground">{inr(breakdown.shippingInr)}</span>
              </div>
              {breakdown.discountInr > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Discount{appliedCode ? ` (${appliedCode})` : ''}</span>
                  <span className="tabular-nums">− {inr(breakdown.discountInr)}</span>
                </div>
              )}
              <div className="seam my-1.5" />
              <div className="flex items-baseline justify-between">
                <span className="font-medium">Total</span>
                <span className="font-display text-2xl font-semibold tabular-nums tracking-[-0.01em]">
                  {pricingBusy ? <Loader2 className="inline h-5 w-5 animate-spin" /> : inr(breakdown.totalInr)}
                </span>
              </div>
            </div>

            {/* Pay + trust */}
            <div className="space-y-4 border-t bg-secondary/30 p-5">
              {error && <p className="text-sm text-destructive">{error}</p>}

              {orderStatus === 'failed' ? (
                <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-semibold text-destructive">Payment didn’t go through</p>
                  <p className="text-sm text-muted-foreground">
                    No charge was made and your album is safe. You can try again.
                  </p>
                  <Button
                    onClick={pay}
                    disabled={busyControls || !selectedId || !scriptReady}
                    className={`w-full ${LUX_PRIMARY}`}
                  >
                    {paying || !scriptReady ? <Loader2 className="animate-spin" /> : <Lock />} Try again · {inr(breakdown.totalInr)}
                  </Button>
                  <Button variant="ghost" render={<Link href={albumHref} />} className="w-full">
                    <ArrowLeft /> Back to album
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    onClick={pay}
                    disabled={busyControls || !selectedId || !scriptReady}
                    className={`h-11 w-full text-[15px] ${LUX_PRIMARY}`}
                  >
                    {paying || !scriptReady ? <Loader2 className="animate-spin" /> : <Lock />}
                    {scriptReady ? `Pay ${inr(breakdown.totalInr)} securely` : 'Preparing secure checkout…'}
                  </Button>
                  {(orderStatus === null || orderStatus === 'pending') && (
                    <Button
                      variant="ghost"
                      onClick={cancelCheckout}
                      disabled={cancelling || paying}
                      className="w-full text-muted-foreground"
                    >
                      {cancelling ? <Loader2 className="animate-spin" /> : <X />} Cancel checkout
                    </Button>
                  )}
                </div>
              )}

              <ul className="space-y-1.5 text-[11.5px] text-muted-foreground">
                <li className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> We never see or store your card details
                </li>
                <li className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-primary" /> Encrypted &amp; verified payment via Razorpay
                </li>
                <li className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 text-primary" /> Step away anytime — your checkout is saved
                </li>
              </ul>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
