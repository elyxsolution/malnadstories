'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Minus, Plus, ReceiptText, ShoppingCart, Trash2, X } from 'lucide-react';

import Book, { paletteFor } from '@/components/book';
import { albumCoverFace, albumCoverSpine } from '@/components/album-cover';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { LUX_PRIMARY } from '@/components/brand';
import { orderStatusView } from '@/lib/orders/status';
import { useCart } from '@/lib/cart/provider';
import { removeFromCart, updateCartQuantity } from '@/lib/actions/cart';

/** Mirrors `CreateOrderSchema.copies` and the `cart_items` CHECK — never a local invention. */
const MAX_QUANTITY = 10;

/*
 * The row shape moved to `lib/cart/rows.ts`, beside the query that produces it — the builder's
 * cart drawer renders the same rows and cannot import a type out of a client component that
 * belongs to the cart page. Re-exported here so every existing importer is unaffected.
 */
export type { CartRow } from '@/lib/cart/rows';
import type { CartRow } from '@/lib/cart/rows';

/**
 * The cart's interactive rows.
 *
 * WHY THIS IS THE ONLY CLIENT PIECE: the page itself stays a Server Component (three RLS-scoped
 * reads, server-side cover normalisation). Just the controls need state — the in-flight lock, the
 * optimistic quantity, and the confirm dialog.
 *
 * THE BADGE IS SET, NOT NUDGED. Every action returns the authoritative distinct-album count from
 * the server, so `setCount` replaces the number outright instead of `bumpCount(±1)` guessing at
 * it. That is exactly what `CartProvider.setCount` was reserved for, and it makes the
 * distinct-album rule automatic: a quantity edit returns the same count, so the badge cannot move
 * on one. `router.refresh()` then re-reads the server state so nothing optimistic can persist.
 */
export default function CartList({ rows }: { rows: CartRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <CartItem key={row.albumId} row={row} />
      ))}
    </div>
  );
}

function CartItem({ row }: { row: CartRow }) {
  const router = useRouter();
  const { setCount } = useCart();
  const [quantity, setQuantity] = useState(row.quantity);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server is authoritative: after a refresh the row arrives with the stored quantity, so
  // adopt it. This is also what restores the displayed value if a write failed.
  useEffect(() => {
    setQuantity(row.quantity);
  }, [row.quantity]);

  useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !removing) setConfirming(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirming, removing]);

  /**
   * Send the ABSOLUTE quantity, never a delta, and never after re-reading the stored value —
   * that is what makes two tabs resolve as last-write-wins instead of racing an increment.
   * The optimistic value is shown immediately and rolled back if the write fails.
   */
  const changeQuantity = async (delta: number) => {
    const next = Math.min(MAX_QUANTITY, Math.max(1, quantity + delta));
    if (next === quantity || busy) return;
    const previous = quantity;
    setQuantity(next);
    setBusy(true);
    setError(null);
    try {
      const res = await updateCartQuantity({ albumId: row.albumId, quantity: next });
      if (!res.ok) {
        setQuantity(previous);
        setError(res.error);
        setBusy(false);
        return;
      }
      // Unchanged for a quantity edit (the badge counts albums), but taken from the server all
      // the same rather than assumed.
      setCount(res.count);
      router.refresh();
    } catch {
      setQuantity(previous);
      setError('Could not update the number of copies. Please try again.');
    }
    setBusy(false);
  };

  const onRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await removeFromCart({ albumId: row.albumId });
      if (!res.ok) {
        setError(res.error);
        setRemoving(false);
        return;
      }
      setCount(res.count);
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Could not remove this album. Please try again.');
      setRemoving(false);
    }
  };

  const locked = busy || removing;
  const statusLabel = row.order ? orderStatusView(row.order.status).label : null;

  return (
    <div className="border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-5 sm:flex-nowrap">
        {/* The album, as the object it will become — the same Book + real cover used on the
            shelf, the album page and checkout. */}
        <Link href={`/albums/${row.albumId}`} className="group flex-none">
          <Book
            title={row.title}
            size="sm"
            thickness={row.size >= 100 ? 12 : 9}
            cover={paletteFor(row.albumId)}
            coverContent={albumCoverFace(row.cover, row.title)}
            spineContent={albumCoverSpine(row.cover, row.title)}
          />
        </Link>

        <div className="min-w-[180px] flex-1">
          <Link href={`/albums/${row.albumId}`} className="block">
            <h2 className="font-display text-xl font-semibold leading-tight tracking-tight text-primary">
              {row.title}
            </h2>
          </Link>
          {row.subtitle && <p className="mt-0.5 font-display text-sm italic text-muted-foreground">{row.subtitle}</p>}
          <p className="mt-2 text-[13px] text-muted-foreground">{row.size} pages · Archival matte</p>

          {row.order ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gold/12 px-2.5 py-1 text-[11px] font-medium text-gold">
              <Check className="h-3 w-3" /> Already ordered{statusLabel ? ` · ${statusLabel}` : ''}
            </span>
          ) : !row.eligible ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <AlertTriangle className="h-3 w-3" /> Not ready to order yet
            </span>
          ) : null}

          {/* Copies — the same stepper interaction as checkout. An already-ordered album keeps
              its stored count as plain text: changing it would imply it affects an order that
              has already been placed. */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Copies</span>
            {row.order ? (
              <span className="text-sm font-medium tabular-nums">{quantity}</span>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => changeQuantity(-1)}
                  disabled={quantity <= 1 || locked}
                  aria-label={`Decrease copies of ${row.title}`}
                >
                  <Minus />
                </Button>
                <span className="w-6 text-center font-medium tabular-nums">{quantity}</span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => changeQuantity(1)}
                  disabled={quantity >= MAX_QUANTITY || locked}
                  aria-label={`Increase copies of ${row.title}`}
                >
                  <Plus />
                </Button>
              </div>
            )}
            {busy && <InlineLoader />}
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </div>

        {/* Actions. Buy Now is a link to the EXISTING checkout — there is no second payment
            path, and no copies parameter: the checkout page reads the cart quantity itself. */}
        <div className="flex w-full flex-col gap-2 sm:w-[168px] sm:flex-none">
          {row.order ? (
            <Button variant="outline" render={<Link href={`/orders/${row.order.orderId}`} />}>
              <ReceiptText /> View order
            </Button>
          ) : row.eligible ? (
            <Button render={<Link href={`/checkout/${row.albumId}`} />} className={LUX_PRIMARY} disabled={locked}>
              <ShoppingCart /> Buy now
            </Button>
          ) : (
            <Button variant="outline" render={<Link href={`/albums/${row.albumId}/build`} />}>
              Finish album
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={locked}
            className="text-destructive hover:text-destructive"
            aria-label={`Remove ${row.title} from cart`}
          >
            <Trash2 /> Remove
          </Button>
        </div>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-4 backdrop-blur-sm"
          onClick={() => !removing && setConfirming(false)}
        >
          <div
            className="animate-rise w-full max-w-sm border bg-card p-5 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-[15px] font-semibold tracking-tight">
                Remove “{row.title}” from your cart?
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirming(false)}
                disabled={removing}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              The album itself, your photos and your layout are all kept — this only takes it out of the cart. You can
              add it back any time.
            </p>
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={removing}>
                Keep in cart
              </Button>
              <Button variant="destructive" size="sm" onClick={onRemove} disabled={removing}>
                {removing ? <InlineLoader /> : <Trash2 />} Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
