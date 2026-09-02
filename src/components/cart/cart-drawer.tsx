'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowRight, ShoppingBag, ShoppingCart, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { albumCoverFace } from '@/components/album-cover';
import { getCartOverview } from '@/lib/actions/cart';
import type { CartRow } from '@/lib/cart/rows';
import { STUDIO_PRIMARY } from '@/app/(app)/albums/[id]/build/_ui';

/**
 * THE CART, OVER THE BUILDER — a look at what is waiting, not a checkout.
 *
 * ── WHY A DRAWER AND NOT A NAVIGATION ──────────────────────────────────────────────────────
 * Opening the cart from inside the builder must not cost the customer their place in an album
 * they are part-way through editing. So the cart comes to them: it overlays the builder, the
 * builder keeps its state, and NOTHING here triggers the unsaved-changes guard — because
 * opening a panel is not leaving. The guard runs on the two controls that genuinely leave
 * (View cart, Checkout), and it runs through the builder's own canonical one via `onLeave`.
 *
 * ── WHAT IT SHOWS, AND THE ONE THING IT DOES NOT ───────────────────────────────────────────
 * The rows come from `getCartOverview`, which is the CART PAGE'S OWN read (`loadCartRows`) —
 * same three queries, same eligibility rule, same stale-row handling. There is no second cart
 * state, no client-side cart store and no second definition of "ready to order".
 *
 * NO PRICES, and that is deliberate rather than missing: this product's cart has never been a
 * pricing surface — `/checkout/[albumId]`, `/checkout/cart` and `createOrder` are the only
 * places money is computed. A total invented for a drawer would be a second answer to the one
 * question only checkout may answer. The drawer says what is in the cart and how many copies;
 * the price appears where it is authoritative.
 *
 * ── WHY BASE UI'S DIALOG ───────────────────────────────────────────────────────────────────
 * Already this project's primitive (the account menu uses its Menu). It brings the parts of an
 * overlay that are unpleasant to hand-roll and dangerous to get wrong: `role="dialog"` +
 * `aria-modal`, a focus trap, focus RETURN to the trigger, Escape, backdrop dismissal, and —
 * the reason it matters here — it keeps the panel mounted through its exit so the close can be
 * animated in CSS. No new overlay architecture, no dependency.
 *
 * The motion lives in `globals.css` (`.ms-drawer-*`), on the project's own easings.
 */
export default function CartDrawer({
  count,
  onLeave,
}: {
  /** The header badge's number — the shell's existing count, not a second source. */
  count: number;
  /**
   * Leaving the builder. The host decides what that means: on the builder it is the canonical
   * unsaved-changes guard, and anywhere else it can simply navigate. Returning nothing keeps
   * this component free of any opinion about dirty state.
   */
  onLeave: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ rows: CartRow[]; eligibleCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** One read in flight at a time; a re-open while loading must not stack requests. */
  const reading = useRef(false);

  /*
   * READ ON OPEN. Not on mount — the builder would pay for a panel most sessions never open —
   * and not on a timer. Re-reading on every open is also what keeps the drawer honest after the
   * customer has submitted another album in a different tab.
   */
  const load = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    setLoading(true);
    setError(null);
    const res = await getCartOverview();
    reading.current = false;
    setLoading(false);
    if (res.ok) setState({ rows: res.rows, eligibleCount: res.eligibleCount });
    else setError(res.error);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** A destination that leaves the builder: close first, then hand over to the host's guard. */
  const leave = (href: string) => {
    setOpen(false);
    onLeave(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/*
        THE TRIGGER. 44x44, labelled with the count so a screen reader hears what a sighted user
        sees on the badge. Base UI supplies `aria-haspopup` and `aria-expanded`.
      */}
      <Dialog.Trigger
        aria-label={count > 0 ? `Cart — ${count} ${count === 1 ? 'album' : 'albums'}` : 'Cart — empty'}
        className="ms-drawer-trigger relative grid h-11 w-11 place-items-center rounded-lg text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-glide hover:bg-secondary hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-studio-bright aria-expanded:bg-secondary aria-expanded:text-foreground"
      >
        <ShoppingCart className="h-[18px] w-[18px]" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="ms-drawer-backdrop fixed inset-0 z-[120] bg-foreground/35 backdrop-blur-[2px]" />
        <Dialog.Popup
          className="ms-drawer-popup fixed inset-y-0 right-0 z-[125] flex w-full max-w-[380px] flex-col border-l border-border bg-background shadow-panel outline-none"
          aria-label="Your cart"
        >
          {/* ── Head ─────────────────────────────────────────────────────── */}
          <div className="flex flex-none items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Your cart</p>
              <Dialog.Title className="mt-1 font-display text-[19px] font-semibold leading-tight tracking-tight">
                Ready when you are
              </Dialog.Title>
            </div>
            <Dialog.Close
              aria-label="Close the cart"
              className="-mr-1.5 -mt-1 grid h-11 w-11 flex-none place-items-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 ease-glide hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-studio-bright"
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </Dialog.Close>
          </div>

          {/* ── Body ─────────────────────────────────────────────────────── */}
          <div className="ms-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {loading && !state ? (
              /* A skeleton that matches the row it becomes, not a spinner in an empty panel. */
              <ul className="space-y-3" aria-hidden>
                {[0, 1].map((i) => (
                  <li key={i} className="flex gap-3">
                    <span className="h-[62px] w-[46px] flex-none animate-pulse rounded-sm bg-muted" />
                    <span className="flex-1 space-y-2 py-1">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
                      <span className="block h-2.5 w-1/3 animate-pulse rounded bg-muted" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : error ? (
              <div className="py-10 text-center">
                <p className="text-[13px] leading-relaxed text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : state && state.rows.length === 0 ? (
              /*
                EMPTY, SAID THE WAY THE CART PAGE SAYS IT — same sentence, same destination, so a
                customer who has seen one has seen the other.
              */
              <div className="py-12 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <ShoppingCart className="h-5 w-5" aria-hidden />
                </span>
                <p className="mt-4 font-display text-[17px] font-semibold tracking-tight">Your cart is empty</p>
                <p className="mx-auto mt-1.5 max-w-[24ch] text-[13px] leading-relaxed text-muted-foreground">
                  Finish an album and submit it — it lands here, ready to order whenever you are.
                </p>
                <Button variant="outline" size="sm" className="mt-5" onClick={() => leave('/dashboard')}>
                  Go to your stories
                </Button>
              </div>
            ) : (
              <ul className="space-y-1">
                {state?.rows.map((row, i) => (
                  <li
                    key={row.albumId}
                    style={{ ['--i' as string]: i }}
                    className="ms-drawer-row flex items-center gap-3 rounded-md px-1.5 py-2"
                  >
                    {/*
                      The album as the object it will become — the SAME cover renderer the cart
                      page and the dashboard shelf use, so one album looks like itself everywhere.
                    */}
                    <span className="h-[62px] w-[46px] flex-none overflow-hidden rounded-sm bg-secondary shadow-xs">
                      {albumCoverFace(row.cover, row.title)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-snug">{row.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground tabular-nums">
                        {row.size} pages
                        {row.quantity > 1 && <> · {row.quantity} copies</>}
                      </span>
                      {!row.eligible && (
                        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">
                          {row.order ? 'Already ordered' : 'Not finished yet'}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Foot ─────────────────────────────────────────────────────── */}
          {state && state.rows.length > 0 && (
            <div className="flex-none border-t border-border/70 px-5 py-4">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {state.eligibleCount === 0
                  ? 'Nothing here is ready to order yet.'
                  : 'Checked out together: one order, one delivery, shipping charged once. Prices are shown at checkout.'}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {state.eligibleCount > 0 && (
                  <Button className={`h-11 ${STUDIO_PRIMARY}`} onClick={() => leave('/checkout/cart')}>
                    <ShoppingBag /> Checkout
                    <span className="tabular-nums">
                      ({state.eligibleCount} {state.eligibleCount === 1 ? 'album' : 'albums'})
                    </span>
                  </Button>
                )}
                <Button variant="outline" className="h-11" onClick={() => leave('/cart')}>
                  View cart <ArrowRight />
                </Button>
              </div>
            </div>
          )}

          {loading && state && (
            <span className="pointer-events-none absolute right-5 top-[70px] text-muted-foreground">
              <InlineLoader />
            </span>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
