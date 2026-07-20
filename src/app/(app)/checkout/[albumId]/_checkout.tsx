'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Lock, ArrowLeft, ArrowRight, Minus, Plus, Tag, Truck, AlertTriangle, Pencil } from 'lucide-react';
import { InlineLoader, MalnadLoader, useRotatingMessage, LOADING_MESSAGES } from '@/components/loading';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createOrder, cancelOrder, previewCoupon, previewOrderAmount } from '@/lib/actions/orders';
import { LUX_PRIMARY } from '@/components/brand';
import { SHIPPING_TIERS, type ShippingMethod } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
import Book from '@/components/book';
import AddressPicker, { type Address } from './_address-picker';
import CheckoutProgress, { STEP_ORDER, type CheckoutStep } from './_progress';
import SuccessScreen from './_success';
import { type ReadinessItem } from './_readiness';
import PrintDiagnostics from '@/components/print-diagnostics';
import { type AlbumValidationReport } from '@/lib/albums/validation';
import { type RenderReadinessReport } from '@/lib/albums/render-readiness';

type AmountBreakdown = { subtotalInr: number; shippingInr: number; discountInr: number; totalInr: number };

type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
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

// Delivery-estimate days per tier — DISPLAY ONLY (the charged fee stays server-authoritative).
const DELIV_DAYS: Record<ShippingMethod, number> = { standard: 9, priority: 5, express: 3 };

export default function Checkout({
  albumId,
  albumTitle,
  albumSub,
  albumSize,
  photoCount,
  formatName,
  formatDimensions,
  coverUrl,
  coverName,
  amount,
  addresses,
  pendingOrderId,
  initialCopies,
  initialCouponCode,
  initialShippingMethod,
  readiness,
  printReady = true,
  validationReport = null,
  renderReport = null,
}: {
  albumId: string;
  albumTitle: string;
  albumSub: string | null;
  albumSize: number;
  photoCount: number;
  formatName: string;
  formatDimensions?: string;
  printReady?: boolean;
  blockingIssues?: string[];
  validationReport?: AlbumValidationReport | null;
  renderReport?: RenderReadinessReport | null;
  coverUrl: string | null;
  coverName: string | null;
  amount: AmountBreakdown;
  addresses: Address[];
  pendingOrderId: string | null;
  initialCopies: number;
  initialCouponCode: string | null;
  initialShippingMethod: ShippingMethod;
  readiness: ReadinessItem[];
}) {
  const router = useRouter();
  const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
  const [selectedId, setSelectedId] = useState<string | null>(defaultAddr?.id ?? null);

  // Stepped flow.
  const [step, setStep] = useState<CheckoutStep>('summary');
  const [maxIdx, setMaxIdx] = useState(0);

  const [scriptReady, setScriptReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [finalizing, setFinalizing] = useState(false); // verifying after the Razorpay modal
  const [cancelling, setCancelling] = useState(false);
  const payInFlight = useRef(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(pendingOrderId);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(pendingOrderId ? 'pending' : null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderId: string; email: string } | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');

  // Copies + coupon + shipping (amounts always come from the SERVER).
  const [copies, setCopies] = useState(initialCopies);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(initialShippingMethod);
  const [breakdown, setBreakdown] = useState<AmountBreakdown>(amount);
  const [couponInput, setCouponInput] = useState(initialCouponCode ?? '');
  const [appliedCode, setAppliedCode] = useState<string | null>(initialCouponCode);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);

  const busyControls = paying || pricingBusy || couponBusy;
  const selectedAddr = addresses.find((a) => a.id === selectedId) ?? null;
  const tier = SHIPPING_TIERS.find((t) => t.method === shippingMethod) ?? SHIPPING_TIERS[0];

  const estDelivery = (() => {
    const d = new Date();
    d.setDate(d.getDate() + DELIV_DAYS[shippingMethod]);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  })();

  // Poll the active order while non-terminal. On paid → cinematic success (NOT a redirect).
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
        if (isPaidStatus(body.status)) setSuccess({ orderId: activeOrderId, email: prefillEmail });
      } catch {
        /* transient */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [activeOrderId, orderStatus, prefillEmail]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.Razorpay) setScriptReady(true);
  }, []);

  // ── server-priced recompute (unchanged logic) ────────────────────────────────
  const recompute = async (nextCopies: number, code: string | null, method: ShippingMethod) => {
    setPricingBusy(true);
    if (code) {
      const res = await previewCoupon({ albumId, copies: nextCopies, shippingMethod: method, code });
      if (res.ok) {
        setBreakdown({ subtotalInr: res.subtotalInr, shippingInr: res.shippingInr, discountInr: res.discountInr, totalInr: res.totalInr });
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
      setBreakdown({ subtotalInr: res.subtotalInr, shippingInr: res.shippingInr, discountInr: res.discountInr, totalInr: res.totalInr });
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

  // ── pay (createOrder → Razorpay) — payment logic UNCHANGED ───────────────────
  const pay = async () => {
    if (!selectedId) {
      setError('Please select a delivery address.');
      setStep('shipping');
      return;
    }
    if (typeof window === 'undefined' || !window.Razorpay) {
      setError('Payment is still loading — please try again in a moment.');
      return;
    }
    if (payInFlight.current) return;
    payInFlight.current = true;
    setPaying(true);
    setError(null);

    try {
      const res = await createOrder({ albumId, addressId: selectedId, copies, shippingMethod, couponCode: appliedCode ?? undefined });
      if (!res.ok) {
        payInFlight.current = false;
        setPaying(false);
        setError(res.error);
        return;
      }
      setActiveOrderId(res.orderId);
      setOrderStatus('pending');
      setPrefillEmail(res.prefill.email);

      const rzp = new window.Razorpay({
        key: res.keyId,
        amount: res.amountPaise,
        currency: res.currency,
        order_id: res.razorpayOrderId,
        name: 'Malnad Stories',
        description: albumTitle,
        prefill: res.prefill,
        theme: { color: '#1e3a2f' },
        handler: async (r) => {
          setFinalizing(true);
          try {
            const v = await fetch('/api/payments/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(r),
            });
            // Success is shown by the poller once the order reaches paid; keep finalizing.
            if (v.ok) return;
          } catch {
            /* fall through */
          }
          setFinalizing(false);
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
    if (res.ok) router.push(albumHref);
    else {
      setError(res.error);
      setOrderStatus('failed');
    }
  };

  // ── step navigation ──────────────────────────────────────────────────────────
  const go = (s: CheckoutStep) => {
    setStep(s);
    setMaxIdx((m) => Math.max(m, STEP_ORDER.indexOf(s)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  const curIdx = STEP_ORDER.indexOf(step);
  const next = () => {
    if (step === 'review') {
      void pay();
      return;
    }
    go(STEP_ORDER[Math.min(STEP_ORDER.length - 1, curIdx + 1)]);
  };
  const back = () => {
    if (step === 'summary') {
      router.push(albumHref);
      return;
    }
    go(STEP_ORDER[Math.max(0, curIdx - 1)]);
  };

  const readyWarnings = readiness.filter((r) => !r.ok).length;
  const showRail = true; // summary..review

  // Footer labels.
  const nextLabel = (() => {
    if (step === 'summary') return 'Continue to shipping';
    if (step === 'shipping') return 'Review order';
    return `Pay ${inr(breakdown.totalInr)}`;
  })();
  const nextDisabled = (() => {
    // CHANGE 2/3: validation warnings NEVER block payment. The customer is informed of any
    // print-readiness issues (PrintNotReadyBanner) but may always continue to pay; the album is
    // reviewed by an admin after payment and, if needed, editing is reopened.
    if (step === 'shipping' && !selectedId) return true;
    if (step === 'review') return busyControls || !selectedId || !scriptReady;
    return false;
  })();

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onLoad={() => setScriptReady(true)}
        onError={() => setError('Could not load the payment library. Please refresh and try again.')}
      />

      {/* Progress header */}
      <header className="sticky top-14 z-20 flex h-16 items-center justify-between gap-4 border-b bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
        <span className="hidden font-display text-[19px] font-semibold text-primary sm:block">Malnad Stories</span>
        <CheckoutProgress step={step} maxIdx={maxIdx} onJump={go} />
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Lock className="h-3.5 w-3.5 text-success" /> Secure
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 px-5 py-8 sm:px-8 lg:py-10">
        <div className={`mx-auto w-full ${showRail ? 'max-w-5xl' : 'max-w-2xl'}`}>
          <div className={showRail ? 'grid items-start gap-8 lg:grid-cols-[1fr_340px]' : ''}>
            <div className="animate-rise min-w-0">
              {/* Structured print diagnostics (Change 10) — the SAME central reports, shown only when
                  something needs attention. Payment is never blocked (our team reviews before print). */}
              {validationReport && (!printReady || (renderReport ? !renderReport.renderable : false)) && (
                <div className="mb-6 space-y-2">
                  <PrintDiagnostics audience="customer" validation={validationReport} render={renderReport} />
                  <p className="px-1 text-[13px] text-muted-foreground">
                    You can still continue with payment — our team reviews every album before it goes to print.{' '}
                    <a href={`/albums/${albumId}/build`} className="font-medium text-primary underline-offset-2 hover:underline">
                      Return to the editor to fix these now
                    </a>
                  </p>
                </div>
              )}
              {step === 'summary' && (
                <div className="space-y-6">
                  <ReadinessBanner items={readiness} warnings={readyWarnings} />
                  <SummaryStep
                    albumTitle={albumTitle}
                    albumSub={albumSub}
                    formatName={formatName}
                    formatDimensions={formatDimensions}
                    albumSize={albumSize}
                    photoCount={photoCount}
                    estDelivery={estDelivery}
                    tierLabel={tier.label}
                    copies={copies}
                    busy={busyControls}
                    onCopies={changeCopies}
                  />
                </div>
              )}
              {step === 'shipping' && (
                <div className="space-y-8">
                  <StepShell eyebrow="Where & how" title="Delivery details">
                    <AddressPicker addresses={addresses} selectedId={selectedId} onSelect={setSelectedId} />
                  </StepShell>
                  <DeliveryStep shippingMethod={shippingMethod} busy={busyControls} onChange={changeShipping} estDelivery={estDelivery} />
                </div>
              )}
              {step === 'review' && (
                <ReviewStep
                  albumTitle={albumTitle}
                  formatName={formatName}
                  albumSize={albumSize}
                  photoCount={photoCount}
                  copies={copies}
                  address={selectedAddr}
                  tierLabel={tier.label}
                  estDelivery={estDelivery}
                  shippingInr={breakdown.shippingInr}
                  appliedCode={appliedCode}
                  total={breakdown.totalInr}
                  onEdit={go}
                />
              )}
              {error && <p className="mt-5 text-sm text-destructive">{error}</p>}
            </div>

            {showRail && (
              <OrderRail
                coverUrl={coverUrl}
                coverName={coverName}
                albumTitle={albumTitle}
                formatName={formatName}
                albumSize={albumSize}
                breakdown={breakdown}
                pricingBusy={pricingBusy}
                appliedCode={appliedCode}
                couponInput={couponInput}
                couponBusy={couponBusy}
                couponError={couponError}
                tierLabel={tier.label}
                estDelivery={estDelivery}
                paying={paying}
                onCouponInput={setCouponInput}
                onApplyCoupon={applyCoupon}
                onRemoveCoupon={removeCoupon}
              />
            )}
          </div>
        </div>
      </main>

      {/* Footer nav */}
      <footer className="sticky bottom-0 z-20 flex h-20 items-center justify-between gap-3 border-t bg-background/95 px-5 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur-sm sm:px-8">
        <div className="min-w-[80px] sm:min-w-[120px]">
          <Button variant="ghost" onClick={back} disabled={paying} size="sm" className="px-2 sm:px-4">
            <ArrowLeft className="mr-1 h-4 w-4" /> {step === 'summary' ? 'Back to album' : 'Back'}
          </Button>
        </div>

        {/* Sticky total on mobile only */}
        <div className="flex flex-col items-center leading-none sm:hidden">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="font-display text-lg font-semibold tabular-nums text-primary">
            {pricingBusy ? <InlineLoader /> : inr(breakdown.totalInr)}
          </span>
        </div>

        <p className="hidden text-xs text-muted-foreground sm:block">
          {step === 'review' ? 'You won’t be charged until you confirm' : `Estimated delivery ${estDelivery}`}
        </p>
        <div className="flex min-w-[100px] sm:min-w-[120px] items-center justify-end gap-2">
          {step === 'review' && (orderStatus === null || orderStatus === 'pending') && (
            <Button variant="ghost" size="sm" onClick={cancelCheckout} disabled={cancelling || paying} className="text-muted-foreground px-2 sm:px-3">
              {cancelling ? <InlineLoader /> : null} Cancel
            </Button>
          )}
          <Button onClick={next} disabled={nextDisabled} className={`${LUX_PRIMARY} px-3 sm:px-4`} size="sm">
            {step === 'review' ? (paying || !scriptReady ? <InlineLoader /> : <Lock />) : null}
            {nextLabel}
            {step !== 'review' && <ArrowRight className="ml-1 h-4 w-4" />}
          </Button>
        </div>
      </footer>

      {/* Processing overlay (verifying after payment) */}
      {(finalizing || (paying && step === 'review')) && !success && (
        <div className="animate-fade-in fixed inset-0 z-[9000] flex flex-col items-center justify-center bg-background/95">
          <FinalizingLoader />
        </div>
      )}

      {/* Cinematic success — only after the order reaches paid */}
      {success && (
        <SuccessScreen
          orderId={`#${success.orderId.slice(0, 8)}`}
          albumTitle={albumTitle}
          coverUrl={coverUrl}
          estDelivery={estDelivery}
          email={success.email}
        />
      )}
    </div>
  );
}

// ── Step shells / content ───────────────────────────────────────────────────────
function StepShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{eyebrow}</p>
      <h1 className="mt-3 font-display text-[2.4rem] font-normal leading-[1.02] tracking-tight text-primary">{title}</h1>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function ReadinessBanner({ items, warnings }: { items: ReadinessItem[]; warnings: number }) {
  if (warnings === 0) return null;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex gap-3 items-start text-sm">
      <AlertTriangle className="h-5 w-5 shrink-0 text-warning mt-0.5" />
      <div>
        <p className="font-semibold text-foreground">A few things need your attention before printing</p>
        <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
          There {warnings === 1 ? 'is' : 'are'} {warnings} warning{warnings === 1 ? '' : 's'} regarding photo resolutions or blank pages.
          While they won’t block checkout, a printed book is permanent. You can edit them in the builder.
        </p>
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground font-medium select-none">View details</summary>
          <div className="mt-2 space-y-2 border-t pt-2 border-warning/10">
            {items.filter(it => !it.ok).map((it, i) => (
              <div key={i}>
                <strong className="text-foreground">{it.title}:</strong> {it.detail}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}


function SummaryStep({
  albumTitle,
  albumSub,
  formatName,
  formatDimensions,
  albumSize,
  photoCount,
  estDelivery,
  tierLabel,
  copies,
  busy,
  onCopies,
}: {
  albumTitle: string;
  albumSub: string | null;
  formatName: string;
  formatDimensions?: string;
  albumSize: number;
  photoCount: number;
  estDelivery: string;
  tierLabel: string;
  copies: number;
  busy: boolean;
  onCopies: (d: number) => void;
}) {
  return (
    <StepShell eyebrow="Your album" title="This is what we’ll make.">
      <div className="rounded-2xl border bg-card p-6 shadow-panel">
        <h3 className="font-display text-2xl font-semibold tracking-tight">{albumTitle}</h3>
        {albumSub && <p className="mt-0.5 font-display text-sm italic text-muted-foreground">{albumSub}</p>}
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <Detail label="Format" value={formatName} />
          <Detail label="Dimensions" value={formatDimensions ?? '—'} />
          <Detail label="Pages" value={`${albumSize} pages`} />
          <Detail label="Photographs" value={`${photoCount} placed`} />
          <Detail label="Paper" value="Archival matte" />
        </div>
        <div className="mt-5 flex items-center justify-between border-t pt-4">
          <span className="text-sm text-muted-foreground">Copies</span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" onClick={() => onCopies(-1)} disabled={copies <= 1 || busy} aria-label="Decrease copies">
              <Minus />
            </Button>
            <span className="w-6 text-center font-medium tabular-nums">{copies}</span>
            <Button variant="outline" size="icon-sm" onClick={() => onCopies(1)} disabled={copies >= MAX_COPIES || busy} aria-label="Increase copies">
              <Plus />
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-2.5 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
        <Truck className="h-4 w-4 text-primary" /> Estimated delivery <strong className="font-medium text-foreground">{estDelivery}</strong> with {tierLabel} delivery.
      </p>
    </StepShell>
  );
}

function DeliveryStep({
  shippingMethod,
  busy,
  onChange,
  estDelivery,
}: {
  shippingMethod: ShippingMethod;
  busy: boolean;
  onChange: (m: ShippingMethod) => void;
  estDelivery: string;
}) {
  return (
    <StepShell eyebrow="How soon" title="Choose your pace.">
      <p className="-mt-4 mb-6 text-[15px] text-muted-foreground">Each album is hand-finished before it ships — these times include crafting.</p>
      <div className="space-y-3">
        {SHIPPING_TIERS.map((t) => {
          const sel = shippingMethod === t.method;
          return (
            <button
              key={t.method}
              type="button"
              onClick={() => onChange(t.method)}
              disabled={busy}
              className={`flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors disabled:opacity-60 ${
                sel ? 'border-primary bg-primary/[0.05] ring-1 ring-primary/30' : 'border-border hover:bg-secondary/40'
              }`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${sel ? 'border-primary' : 'border-muted-foreground/40'}`}>
                {sel && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
              </span>
              <span className="flex-1">
                <span className="block font-display text-lg font-medium text-primary">{t.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.window} · arrives ~{estDelivery}
                </span>
              </span>
              <span className="font-display text-lg font-semibold tabular-nums">{t.feeInr === 0 ? 'Free' : inr(t.feeInr)}</span>
            </button>
          );
        })}
      </div>
    </StepShell>
  );
}

function ReviewStep({
  albumTitle,
  formatName,
  albumSize,
  photoCount,
  copies,
  address,
  tierLabel,
  estDelivery,
  shippingInr,
  appliedCode,
  total,
  onEdit,
}: {
  albumTitle: string;
  formatName: string;
  albumSize: number;
  photoCount: number;
  copies: number;
  address: Address | null;
  tierLabel: string;
  estDelivery: string;
  shippingInr: number;
  appliedCode: string | null;
  total: number;
  onEdit: (s: CheckoutStep) => void;
}) {
  const rows: { label: string; value: string; step: CheckoutStep }[] = [
    {
      label: 'Album',
      value: `${albumTitle} · ${formatName} · ${albumSize} pages · ${photoCount} photos${copies > 1 ? ` · ${copies} copies` : ''}`,
      step: 'summary',
    },
    {
      label: 'Ship to',
      value: address ? `${address.full_name}, ${address.line1}, ${address.city}, ${address.state} ${address.pincode}` : 'No address selected',
      step: 'shipping',
    },
    { label: 'Delivery', value: `${tierLabel} · arrives ~${estDelivery} · ${shippingInr === 0 ? 'Free' : inr(shippingInr)}`, step: 'shipping' },
    { label: 'Payment', value: 'Razorpay secure checkout (UPI, Cards, Netbanking, Wallets)', step: 'review' },
    { label: 'Coupon', value: appliedCode ?? 'None applied', step: 'summary' },
  ];
  return (
    <StepShell eyebrow="Final check" title="Review & Pay">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-panel">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-4 border-b px-6 py-4 last:border-0">
            <span className="w-20 shrink-0 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{r.label}</span>
            <span className="min-w-0 flex-1 text-sm leading-relaxed">{r.value}</span>
            {r.step !== 'review' && (
              <button type="button" onClick={() => onEdit(r.step)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
          </div>
        ))}
        
        {/* Payment reassurance folded right here into the review box */}
        <div className="bg-muted/10 border-t px-6 py-4 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-success" /> Secure Checkout Guarantees:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Payments processed securely via Razorpay (UPI, cards, net banking, wallets).</li>
            <li>We never see or store your payment details.</li>
            <li>Clicking the pay button below will launch the secure checkout window.</li>
          </ul>
        </div>

        <div className="flex items-baseline justify-between bg-secondary/40 px-6 py-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total</span>
          <span className="font-display text-3xl font-semibold tabular-nums text-primary">{inr(total)}</span>
        </div>
      </div>
    </StepShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

/** Post-payment overlay loader — rotating, centralized checkout copy (no hardcoded string). */
function FinalizingLoader() {
  const label = useRotatingMessage(LOADING_MESSAGES.checkout);
  return <MalnadLoader size={120} label={label} className="[&_p]:mt-5 [&_p]:font-display [&_p]:text-xl [&_p]:italic" />;
}

// ── Persistent order rail ─────────────────────────────────────────────────────────
function OrderRail({
  coverUrl,
  coverName,
  albumTitle,
  formatName,
  albumSize,
  breakdown,
  pricingBusy,
  appliedCode,
  couponInput,
  couponBusy,
  couponError,
  tierLabel,
  estDelivery,
  paying,
  onCouponInput,
  onApplyCoupon,
  onRemoveCoupon,
}: {
  coverUrl: string | null;
  coverName: string | null;
  albumTitle: string;
  formatName: string;
  albumSize: number;
  breakdown: AmountBreakdown;
  pricingBusy: boolean;
  appliedCode: string | null;
  couponInput: string;
  couponBusy: boolean;
  couponError: string | null;
  tierLabel: string;
  estDelivery: string;
  paying: boolean;
  onCouponInput: (v: string) => void;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
}) {
  return (
    <aside className="overflow-hidden rounded-2xl border bg-card shadow-panel lg:sticky lg:top-[6.5rem]">
      <div className="flex items-center gap-4 border-b p-5">
        <div className="shrink-0">
          <Book title={coverName ?? albumTitle} coverImage={coverUrl} size="sm" thickness={albumSize >= 100 ? 12 : 9} />
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">{albumTitle}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatName} · {albumSize} pages
          </p>
        </div>
      </div>

      {/* Coupon */}
      <div className="border-b p-5">
        {appliedCode ? (
          <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-success">
              <Tag className="h-3.5 w-3.5" />
              <span className="font-mono font-medium">{appliedCode}</span> applied
            </span>
            <button type="button" onClick={onRemoveCoupon} disabled={paying} className="text-xs text-muted-foreground hover:text-destructive">
              Remove
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input value={couponInput} onChange={(e) => onCouponInput(e.target.value.toUpperCase())} placeholder="Coupon code" disabled={couponBusy} className="font-mono" />
            <Button variant="outline" onClick={onApplyCoupon} disabled={couponBusy || !couponInput.trim()}>
              {couponBusy ? <InlineLoader /> : null} Apply
            </Button>
          </div>
        )}
        {couponError && <p className="mt-2 text-xs text-destructive">{couponError}</p>}
      </div>

      {/* Price lines */}
      <div className="space-y-2.5 border-b p-5 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{formatName} album</span>
          <span className="tabular-nums text-foreground">{inr(breakdown.subtotalInr)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping · {tierLabel}</span>
          <span className="tabular-nums text-foreground">{breakdown.shippingInr === 0 ? 'Free' : inr(breakdown.shippingInr)}</span>
        </div>
        {breakdown.discountInr > 0 && (
          <div className="flex justify-between text-success">
            <span>Discount{appliedCode ? ` (${appliedCode})` : ''}</span>
            <span className="tabular-nums">− {inr(breakdown.discountInr)}</span>
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between p-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Total</span>
        <span className="font-display text-3xl font-semibold tabular-nums text-primary">
          {pricingBusy ? <InlineLoader /> : inr(breakdown.totalInr)}
        </span>
      </div>
      <p className="flex items-center gap-2 border-t bg-secondary/30 px-5 py-3 text-[11.5px] text-muted-foreground">
        <Truck className="h-3.5 w-3.5 text-primary" /> Est. delivery {estDelivery}
      </p>
    </aside>
  );
}
