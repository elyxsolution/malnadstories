import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppHeaderGate from '@/components/app-header-gate';
import { UploadProvider } from '@/lib/uploads/upload-provider';
import { PendingPlacementsProvider } from '@/lib/builder/pending-placements';
import { CartProvider } from '@/lib/cart/provider';
import { getCartCount } from '@/lib/cart/queries';
import { getUserWithDeadline } from '@/lib/supabase/timeout';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();

  // Bounded, for the same reason as src/middleware.ts: this is the ONE auth check shared by
  // every route in this group (/dashboard, /cart, /orders, /reviews, /support, /account,
  // /albums/*, /checkout/*), so an unbounded call here turns a Supabase Auth stall into a
  // 504 on all of them at once. A timeout is treated exactly as "signed out" — fail closed.
  const { user, timedOut } = await getUserWithDeadline(supabase);

  if (timedOut) {
    console.warn('[app-layout] supabase auth check exceeded its deadline — redirecting to /login');
  }

  if (!user) redirect('/login');

  // The cart badge's number, fetched ONCE here rather than in each of the fourteen pages
  // that render CustomerShell. RLS scopes it to this user; `getCartCount` returns 0 rather
  // than throwing, so chrome can never break the app shell.
  const cartCount = await getCartCount(supabase);

  /*
   * `min-h-[100dvh]`, not `min-h-screen`. `100vh` is the LARGE viewport — it ignores a visible
   * mobile URL bar — so a shell sized to it is taller than the window whenever that bar is
   * showing, and the DOCUMENT scrolls by exactly that difference even when nothing overflows.
   * The builder is a fixed-viewport editor (`h-[100dvh]`, its own header, its own scroll areas),
   * so that gap was the one place it could still be scrolled as a page. `dvh` tracks the real
   * window on every route, which is what every page here already wanted.
   */
  return (
    <div className="flex flex-col min-h-[100dvh]">
      {/* Hidden on the builder route, which renders its own unified full-bleed header. */}
      <AppHeaderGate email={user.email!} />
      {/*
        Uploads outlive the page that started them (Phase 3). The provider owns ONE
        UploadManager for the session, mounted here because Phase 0 proved this layout is not
        remounted by /albums/new → /albums/[id]/build. It sits BELOW the auth guard above, so
        it only ever exists for a signed-in user, and ABOVE both upload surfaces.
        It is the client boundary — this layout stays a Server Component.
      */}
      <main className="flex-1">
        <UploadProvider>
          {/*
            Auto Create can place photos that are still uploading; their positions cannot be
            written to the database until the ids are real, so the intent is held here — in
            memory, album-scoped, coordinates only — across the one navigation it must survive.
            Nested inside UploadProvider because it is meaningless without uploads in flight.
          */}
          <PendingPlacementsProvider>
            {/*
              The cart badge's count (Phase 6). Innermost so the two upload providers keep
              their existing positions and lifecycles exactly — this one has no dependency on
              either, and holds nothing but a number.
            */}
            <CartProvider initialCount={cartCount}>{children}</CartProvider>
          </PendingPlacementsProvider>
        </UploadProvider>
      </main>
    </div>
  );
}
