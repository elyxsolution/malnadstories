'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Loader2, CreditCard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createOrder } from '@/lib/actions/orders';
import { cancelOrder } from '@/lib/actions/orders';
import AddressPicker, { type Address } from './_address-picker';

type AmountBreakdown = { subtotalInr: number; shippingInr: number; totalInr: number };

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

export default function Checkout({
  albumId,
  albumTitle,
  amount,
  addresses,
  pendingOrderId,
}: {
  albumId: string;
  albumTitle: string;
  amount: AmountBreakdown;
  addresses: Address[];
  pendingOrderId: string | null;
}) {
  const router = useRouter();
  const defaultAddr = addresses.find((a) => a.is_default) ?? addresses[0];
  const [selectedId, setSelectedId] = useState<string | null>(defaultAddr?.id ?? null);
  const [scriptReady, setScriptReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // An order id we've created this session (or a pending one carried from the server)
  // — lets the user abandon checkout so the album unlocks.
  const [activeOrderId, setActiveOrderId] = useState<string | null>(pendingOrderId);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!selectedId) {
      setError('Please select a delivery address.');
      return;
    }
    if (!scriptReady || !window.Razorpay) {
      setError('Payment is still loading — please try again in a moment.');
      return;
    }
    setPaying(true);
    setError(null);

    const res = await createOrder({ albumId, addressId: selectedId });
    if (!res.ok) {
      setPaying(false);
      setError(res.error);
      return;
    }
    setActiveOrderId(res.orderId);

    const rzp = new window.Razorpay({
      key: res.keyId,
      amount: res.amountPaise,
      currency: res.currency,
      order_id: res.razorpayOrderId,
      name: 'Malnad Stories',
      description: albumTitle,
      prefill: res.prefill,
      theme: { color: '#0f172a' },
      handler: async (r) => {
        // Secondary signature check (fulfillment still comes from the webhook).
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
          // fall through to the error below
        }
        setPaying(false);
        setError('We could not verify the payment. If you were charged, it will confirm shortly.');
      },
      modal: {
        ondismiss: () => {
          // User closed the modal without paying — order stays pending; offer cancel.
          setPaying(false);
        },
      },
    });
    rzp.open();
  };

  const abandon = async () => {
    if (!activeOrderId) return;
    setCancelling(true);
    setError(null);
    const res = await cancelOrder({ orderId: activeOrderId });
    setCancelling(false);
    if (res.ok) {
      router.push('/dashboard');
    } else {
      setError(res.error);
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

      <section className="space-y-2 rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-semibold">Order summary</h2>
        <div className="flex justify-between text-muted-foreground">
          <span>Album ({albumTitle})</span>
          <span>{inr(amount.subtotalInr)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Shipping</span>
          <span>{inr(amount.shippingInr)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t pt-2 font-medium">
          <span>Total</span>
          <span>{inr(amount.totalInr)}</span>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={pay} disabled={paying || !selectedId}>
          {paying ? <Loader2 className="animate-spin" /> : <CreditCard />} Pay {inr(amount.totalInr)}
        </Button>
        {activeOrderId && (
          <Button variant="ghost" size="sm" onClick={abandon} disabled={cancelling}>
            {cancelling ? <Loader2 className="animate-spin" /> : <X />} Cancel checkout
          </Button>
        )}
      </div>
    </div>
  );
}
