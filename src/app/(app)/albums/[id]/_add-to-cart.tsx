'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineLoader } from '@/components/loading';
import { useCart } from '@/lib/cart/provider';
import { addAlbumToCart } from '@/lib/actions/cart';

/**
 * "Add to cart" for a submitted album — the first UI to call `addAlbumToCart` (Phase 6 built the
 * action; nothing invoked it until now).
 *
 * IT CALLS THE EXISTING ACTION UNCHANGED. Ownership, blueprint-draft rejection and the
 * `submitted` requirement are all enforced there, server-side; rendering this button only for a
 * submitted album is UX, not a gate.
 *
 * THE BADGE IS SET FROM THE SERVER'S COUNT, not incremented locally. That is what keeps the
 * distinct-album rule honest without a second query: adding an album that is already in the cart
 * raises its quantity but returns the SAME count, so the badge correctly does not move.
 */
export default function AddToCartButton({ albumId }: { albumId: string }) {
  const router = useRouter();
  const { setCount } = useCart();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAdd = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addAlbumToCart({ albumId, quantity: 1 });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      setCount(res.count);
      setAdded(true);
      router.refresh();
    } catch {
      setError('Could not add this album to your cart. Please try again.');
    }
    setBusy(false);
  };

  if (added) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button variant="outline" render={<Link href="/cart" />}>
          <Check /> In your cart — view cart
        </Button>
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add another copy'}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="outline" onClick={onAdd} disabled={busy}>
        {busy ? <InlineLoader /> : <ShoppingCart />} Add to cart
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
