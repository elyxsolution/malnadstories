'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * THE CART COUNT, for the sidebar badge.
 *
 * WHY A PROVIDER AND NOT A PROP. `CustomerShell` is rendered by fourteen pages, each
 * passing `email`. Threading a count the same way would mean fourteen new queries and
 * fourteen edited files for one number. Mounting this in `(app)/layout.tsx` instead costs
 * ONE server-side count: the layout already calls `getUser()`, already hosts
 * `UploadProvider` and `PendingPlacementsProvider`, and Phase 0 established that it is not
 * remounted by normal navigation — which is exactly the property a persistent badge needs.
 *
 * THE DATABASE STAYS AUTHORITATIVE. This holds no cart contents and no localStorage copy —
 * only the number the server last told us, so it can be rendered without a client fetch.
 * No store, no singleton, no polling, no timers, no sockets: `initialCount` arrives with the
 * server render, and `revalidatePath` in the cart action makes the layout produce a fresh
 * one on the next server pass.
 *
 * `setCount` / `bumpCount` exist for Phase 7, which will want the badge to move the instant
 * a customer clicks Add or Remove rather than waiting for a round trip. Nothing calls them
 * yet, and that is deliberate — the mutations they would follow do not exist.
 */
type CartValue = {
  /** Number of DISTINCT ALBUMS in the cart (not the sum of copies). */
  count: number;
  /** Replace the count — for a Phase 7 mutation that knows the new total. */
  setCount: (n: number) => void;
  /** Nudge the count optimistically — for a Phase 7 add/remove. */
  bumpCount: (delta: number) => void;
};

const NOOP: CartValue = { count: 0, setCount: () => {}, bumpCount: () => {} };

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ initialCount, children }: { initialCount: number; children: ReactNode }) {
  const [count, setCount] = useState(initialCount);

  // The layout re-renders with a fresh server count after `revalidatePath`; adopt it.
  // Without this the badge would keep the number captured when the provider first mounted,
  // because the layout is deliberately never remounted.
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const bumpCount = useCallback((delta: number) => {
    setCount((c) => Math.max(0, c + delta));
  }, []);

  const value = useMemo<CartValue>(() => ({ count, setCount, bumpCount }), [count, bumpCount]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * Read the cart count. Falls back to a zero no-op outside the provider so a component that
 * renders in isolation (a test, a page outside the `(app)` group) cannot crash on chrome.
 */
export function useCart(): CartValue {
  return useContext(CartContext) ?? NOOP;
}
