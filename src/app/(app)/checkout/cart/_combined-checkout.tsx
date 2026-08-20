'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { AlertTriangle, ArrowLeft, Lock, Tag, Truck } from 'lucide-react';

import Book, { paletteFor } from '@/components/book';
import { albumCoverFace, albumCoverSpine } from '@/components/album-cover';
import type { CoverConfig } from '@/lib/builder/cover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import { SHIPPING_TIERS, type ShippingMethod } from '@/lib/shipping';
import { createCombinedOrder, previewCombinedOrder } from '@/lib/actions/orders-combined';
import AddressPicker, { type Address } from '../[albumId]/_address-picker';

/**
 * COMBINED CHECKOUT — the client half (Phase 8).
 *
 * It reuses the single-album route's pieces rather than reimplementing them: the same
 * `AddressPicker`, the same `SHIPPING_TIERS` selector shape, the same coupon field, the same
 * `next/script` Razorpay load and the same handler sequence (create order → open Razorpay →
 * POST the callback to the EXISTING `/api/payments/verify`). `_checkout.tsx` itself is untouched:
 * it carries a per-album readiness panel and a copies stepper that have no meaning here, so
 * bending one component around both flows would have put the working single-album purchase at
 * risk for no gain.
 *
 * NO AMOUNT IS EVER SENT. Every figure below arrives from the server (the page's projection, or
 * `previewCombinedOrder` after a tier/coupon change) and is display-only; `createCombinedOrder`
 * re-resolves the cart and recomputes the total at pay time, and the webhook then gates the
 * captured amount against `orders.total_amount`. The customer's cart is NOT cleared here —
 * that happens server-side on the paid transition.
 */

type Line = {
  albumId: string;
  albumTitle: string;
  subtitle: string | null;
  size: number;
  copies: number;
  unitPriceInr: number;
  lineSubtotalInr: number;
  productName: string | null;
  cover: CoverConfig | null;
};

type Blocked = { albumId: string; albumTitle: string; message: string };
type Amount = { subtotalInr: number; shippingInr: number; discountInr: number; totalInr: number };

type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler?: (r: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
};
type RazorpayInstance = { open: () => void };
/**
 * Read the constructor off `window` locally instead of re-declaring the global — the
 * single-album checkout already augments `Window.Razorpay`, and a second `declare global` with a
 * structurally identical type is a duplicate-declaration error.
 */
const razorpayCtor = () =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Razorpay?: new (options: RazorpayOptions) => RazorpayInstance }).Razorpay;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const DELIV_DAYS: Record<ShippingMethod, number> = { standard: 9, priority: 5, express: 3 };

export default function CombinedCheckout({
  lines,
  blocked,
  amount: initialAmount,
  addresses,
  initialShippingMethod,
  email,
}: {
  lines: Line[];
  blocked: Blocked[];
  amount: Amount;
  addresses: Address[];
  initialShippingMethod: ShippingMethod;
  email: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<Amount>(initialAmount);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(initialShippingMethod);
  const [selectedId, setSelectedId] = useState<string | null>(addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? null);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: only ever one createCombinedOrder in flight per click sequence, matching
  // the single-album flow's `payInFlight` ref.
  const payInFlight = useRef(false);

  const totalCopies = lines.reduce((n, l) => n + l.copies, 0);
  const estDelivery = new Date(Date.now() + DELIV_DAYS[shippingMethod] * 86_400_000).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const address = addresses.find((a) => a.id === selectedId) ?? null;

  /** Ask the SERVER to re-price. The client never computes a total itself. */
  const reprice = async (method: ShippingMethod, code: string | null) => {
    setBusy(true);
    setCouponError(null);
    const res = await previewCombinedOrder({ shippingMethod: method, couponCode: code ?? undefined });
    if (res.ok) {
      setAmount({
        subtotalInr: res.subtotalInr,
        shippingInr: res.shippingInr,
        discountInr: res.discountInr,
        totalInr: res.totalInr,
      });
      setAppliedCode(res.couponCode);
    } else if (code) {
      // A coupon that stopped validating is dropped, and the amount re-priced without it.
      setCouponError(res.error);
      setAppliedCode(null);
      const fallback = await previewCombinedOrder({ shippingMethod: method });
      if (fallback.ok) {
        setAmount({
          subtotalInr: fallback.subtotalInr,
          shippingInr: fallback.shippingInr,
          discountInr: fallback.discountInr,
          totalInr: fallback.totalInr,
        });
      }
    } else {
      setError(res.error);
    }
    setBusy(false);
  };

  const onTier = async (m: ShippingMethod) => {
    if (m === shippingMethod || busy || paying) return;
    setShippingMethod(m);
    await reprice(m, appliedCode);
  };

  const onApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code || busy || paying) return;
    await reprice(shippingMethod, code);
  };

  const onRemoveCoupon = async () => {
    setCouponInput('');
    setAppliedCode(null);
    await reprice(shippingMethod, null);
  };

  const onPay = async () => {
    if (!selectedId) {
      setError('Please select a delivery address.');
      return;
    }
    const Razorpay = razorpayCtor();
    if (!Razorpay) {
      setError('Payment is still loading — please try again in a moment.');
      return;
    }
    if (payInFlight.current) return;
    payInFlight.current = true;
    setPaying(true);
    setError(null);

    try {
      // The server re-resolves the cart here: whatever it returns IS the order.
      const res = await createCombinedOrder({
        addressId: selectedId,
        shippingMethod,
        couponCode: appliedCode ?? undefined,
      });
      if (!res.ok) {
        payInFlight.current = false;
        setPaying(false);
        setError(res.error);
        return;
      }

      const rzp = new Razorpay({
        key: res.keyId,
        amount: res.amountPaise, // server-computed; equals orders.total_amount
        currency: res.currency,
        order_id: res.razorpayOrderId,
        name: 'Malnad Stories',
        description: `${res.lines.length} album${res.lines.length === 1 ? '' : 's'}`,
        prefill: res.prefill,
        theme: { color: '#1e3a2f' },
        handler: async (r) => {
          // The EXISTING verification endpoint — signature checked server-side, then the same
          // atomic RPC the webhook uses. No verification logic is duplicated here.
          try {
            await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(r),
            });
          } catch {
            /* the webhook remains the backstop */
          }
          // The order page owns the paid/pending presentation and its own poller.
          router.push(`/orders/${res.orderId}`);
        },
        modal: {
          ondismiss: () => {
            // Abandoned: the pending order stays, and the CART IS UNTOUCHED.
            payInFlight.current = false;
            setPaying(false);
          },
        },
      });
      rzp.open();
    } catch {
      payInFlight.current = false;
      setPaying(false);
      setError('Something went wrong starting the payment. Please try again.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-9 sm:px-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      <div className="flex items-center justify-between gap-4">
        <Link href="/cart" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Cart
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <Lock className="h-3 w-3" /> Secure
        </span>
      </div>

      <div className="mt-6 animate-rise">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Checkout</p>
        <h1 className="mt-2 font-display text-[2.4rem] font-semibold leading-none tracking-tight">
          {lines.length === 1 ? 'One album, ready to print.' : `${lines.length} albums, one order.`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {totalCopies} {totalCopies === 1 ? 'copy' : 'copies'} · printed and hand-bound · one delivery.
        </p>
      </div>

      {blocked.length > 0 && (
        <div className="mt-6 border border-destructive/30 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" /> Not everything in your cart can be ordered
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {blocked.map((b) => (
              <li key={b.albumId}>{b.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            These are left out of this order — <Link href="/cart" className="text-primary underline-offset-2 hover:underline">go back to your cart</Link> to fix or remove them.
          </p>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {/* What is being bought */}
          <section className="border bg-card p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Your albums</h2>
            <div className="mt-4 flex flex-col divide-y">
              {lines.map((l) => (
                <div key={l.albumId} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="flex-none">
                    <Book
                      title={l.albumTitle}
                      size="sm"
                      thickness={l.size >= 100 ? 12 : 9}
                      cover={paletteFor(l.albumId)}
                      coverContent={albumCoverFace(l.cover, l.albumTitle)}
                      spineContent={albumCoverSpine(l.cover, l.albumTitle)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg leading-tight text-primary">{l.albumTitle}</p>
                    {l.subtitle && <p className="mt-0.5 font-display text-sm italic text-muted-foreground">{l.subtitle}</p>}
                    <p className="mt-1.5 text-[13px] text-muted-foreground">
                      {l.productName ?? 'Album'} · {l.size} pages
                    </p>
                    <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">
                      {inr(l.unitPriceInr)} × {l.copies} {l.copies === 1 ? 'copy' : 'copies'}
                    </p>
                  </div>
                  <p className="flex-none font-medium tabular-nums">{inr(l.lineSubtotalInr)}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Address */}
          <section className="border bg-card p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Delivery address</h2>
            <div className="mt-4">
              <AddressPicker addresses={addresses} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </section>

          {/* Delivery tier */}
          <section className="border bg-card p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Delivery speed</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Charged once for the whole order, however many albums.</p>
            <div className="mt-4 flex flex-col gap-2">
              {SHIPPING_TIERS.map((t) => {
                const active = t.method === shippingMethod;
                return (
                  <button
                    key={t.method}
                    type="button"
                    onClick={() => onTier(t.method)}
                    disabled={busy || paying}
                    className={`flex items-center justify-between rounded-sm border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                      active ? 'border-primary bg-primary/[0.04]' : 'border-input hover:border-primary/40'
                    }`}
                  >
                    <span>
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className="ml-2 text-[13px] text-muted-foreground">{t.window}</span>
                    </span>
                    <span className="text-sm font-medium tabular-nums">{inr(t.feeInr)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex items-center gap-2 rounded-sm bg-secondary px-4 py-3 text-sm text-muted-foreground">
              <Truck className="h-4 w-4 text-primary" /> Estimated delivery{' '}
              <strong className="font-medium text-foreground">{estDelivery}</strong>
            </p>
          </section>
        </div>

        {/* Order summary rail */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border bg-card p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Order summary</h2>

            <div className="mt-4 flex gap-2">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Coupon code"
                className="h-9 text-sm"
                disabled={busy || paying || !!appliedCode}
              />
              {appliedCode ? (
                <Button variant="outline" size="sm" onClick={onRemoveCoupon} disabled={busy || paying}>
                  Remove
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={onApplyCoupon} disabled={busy || paying || !couponInput.trim()}>
                  Apply
                </Button>
              )}
            </div>
            {appliedCode && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-primary">
                <Tag className="h-3.5 w-3.5" /> {appliedCode} applied
              </p>
            )}
            {couponError && <p className="mt-2 text-xs text-destructive">{couponError}</p>}

            <div className="mt-5 space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>
                  {lines.length} {lines.length === 1 ? 'album' : 'albums'} · {totalCopies}{' '}
                  {totalCopies === 1 ? 'copy' : 'copies'}
                </span>
                <span className="tabular-nums text-foreground">{inr(amount.subtotalInr)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping · once</span>
                <span className="tabular-nums text-foreground">{inr(amount.shippingInr)}</span>
              </div>
              {amount.discountInr > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Discount</span>
                  <span className="tabular-nums">- {inr(amount.discountInr)}</span>
                </div>
              )}
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t pt-4">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Total</span>
              <span className="font-display text-2xl font-semibold tabular-nums">{inr(amount.totalInr)}</span>
            </div>

            {error && <p className="mt-4 text-xs text-destructive">{error}</p>}

            <Button
              onClick={onPay}
              disabled={paying || busy || !selectedId}
              className={`mt-5 w-full ${LUX_PRIMARY}`}
            >
              {paying ? <InlineLoader /> : <Lock />} Pay {inr(amount.totalInr)}
            </Button>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {address ? `Shipping to ${address.full_name}, ${address.city}.` : 'Select an address to continue.'}{' '}
              {email ? `Confirmation to ${email}.` : ''} Your cart stays as it is until the payment succeeds.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
