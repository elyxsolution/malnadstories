'use client';

import { Check } from 'lucide-react';

export type CheckoutStep = 'ready' | 'summary' | 'shipping' | 'delivery' | 'payment' | 'review';

export const STEP_ORDER: CheckoutStep[] = ['ready', 'summary', 'shipping', 'delivery', 'payment', 'review'];
const STEP_LABEL: Record<CheckoutStep, string> = {
  ready: 'Readiness',
  summary: 'Summary',
  shipping: 'Shipping',
  delivery: 'Delivery',
  payment: 'Payment',
  review: 'Review',
};

/**
 * Checkout progress header (Claude Design). Presentation only — it reflects the current
 * step and lets the user jump back to any step they've already reached. It never gates
 * payment; that stays in createOrder/Razorpay.
 */
export default function CheckoutProgress({
  step,
  maxIdx,
  onJump,
}: {
  step: CheckoutStep;
  maxIdx: number;
  onJump: (s: CheckoutStep) => void;
}) {
  const curIdx = STEP_ORDER.indexOf(step);
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
      {STEP_ORDER.map((s, i) => {
        const done = i < curIdx;
        const active = i === curIdx;
        const reachable = i <= maxIdx;
        return (
          <li key={s}>
            <button
              type="button"
              onClick={() => reachable && onJump(s)}
              disabled={!reachable}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span
                className={`grid h-[23px] w-[23px] place-items-center rounded-full border font-mono text-[10px] font-semibold transition-colors ${
                  active || done ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={`hidden text-xs tracking-[0.02em] sm:inline ${
                  active ? 'font-semibold text-foreground' : done ? 'text-muted-foreground' : 'text-muted-foreground/70'
                }`}
              >
                {STEP_LABEL[s]}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
