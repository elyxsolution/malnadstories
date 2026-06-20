'use client';

import { useState } from 'react';
import { Check, AlertTriangle, ChevronDown, ShieldCheck } from 'lucide-react';

export type ReadinessItem = {
  ok: boolean;
  title: string;
  detail: string;
  /** Advisory items (e.g. low-res) are a soft "worth a look", never a hard problem. */
  advisory?: boolean;
};

/**
 * Advisory pre-print readiness panel (Design Completion Phase 1). Mirrors the
 * prototype's "Before it goes to print" check, computed server-side from existing
 * data. It is PURELY informational — it never gates the existing pay button; a printed
 * album is permanent, so we surface what's worth a look and let the customer continue.
 */
export default function ReadinessCheck({ items }: { items: ReadinessItem[] }) {
  const issues = items.filter((i) => !i.ok);
  const allGood = issues.length === 0;
  const [open, setOpen] = useState(!allGood);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2.5">
          <span
            className={`grid h-7 w-7 place-items-center rounded-lg ${
              allGood ? 'bg-primary/10 text-primary' : 'bg-warning/12 text-warning'
            }`}
          >
            {allGood ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <span>
            <span className="block font-display text-[15px] font-semibold tracking-tight">Before it goes to print</span>
            <span className={`block text-xs ${allGood ? 'text-primary' : 'text-warning'}`}>
              {allGood
                ? 'Everything checks out — ready for the press.'
                : `${issues.length} thing${issues.length === 1 ? '' : 's'} worth a look`}
            </span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul className="border-t">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 border-b px-5 py-3 last:border-0">
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                  it.ok ? 'bg-primary/10 text-primary' : 'bg-warning/15 text-warning'
                }`}
              >
                {it.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{it.title}</span>
                <span className="block text-xs text-muted-foreground">{it.detail}</span>
              </span>
            </li>
          ))}
          {!allGood && (
            <li className="px-5 py-3 text-[11px] text-muted-foreground">
              Warnings won’t stop you — a printed album is permanent, so it’s worth a look. You can head back to the
              builder to make changes any time.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
