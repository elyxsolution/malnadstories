'use client';

import Link from 'next/link';
import Image from 'next/image';
import { InlineLoader } from '@/components/loading';

import AccountMenu from '@/components/account/account-menu';
import CartDrawer from '@/components/cart/cart-drawer';
import { useCart } from '@/lib/cart/provider';
import { accountIdentity } from '@/lib/auth/identity';
import WizardProgress from '@/components/wizard-progress';
import { LAST_WIZARD_STEP } from '@/lib/wizard/steps';

/**
 * The ONE builder navbar — merges the global app header and the builder's identity/action
 * row into a single sticky bar. The global AppHeader is suppressed on the builder route
 * (see app-header-gate), so this is the only chrome above the editor.
 *
 *   Logo · Album Details — Upload & Build (progress) · Save & exit · Cart · Account
 *
 * The progress indicator is the SHARED `WizardProgress`, driven by `WIZARD_STEPS`. It used
 * to be a second, hand-maintained four-entry array declared right here — which had already
 * drifted from the wizard's own copy (its fourth step said "Review" where the wizard said
 * "Create"). There is now one declaration; this file states only WHERE the builder sits in
 * it, which is the final step: reaching the builder means the album already exists.
 *
 * ── THE ACCOUNT AREA ───────────────────────────────────────────────────────────────────────
 * It used to print the signed-in address in plain text beside a "Log out" icon: a customer's
 * email on screen for anyone standing behind them, and a session-ending action one mis-click
 * from the editor. Both now live inside the account menu, and the cart sits beside it.
 *
 * NEITHER CONTROL IS NEW WORK. The account menu is the SAME `AccountMenu` the public masthead
 * and the app header render — `context="app"`, which is what makes it offer Home / Stories /
 * Contact & FAQ and Log out. The cart badge is the SAME `useCart` count the customer shell's
 * badge reads. There is no second account menu and no second cart state.
 *
 * ── AND NEITHER MAY LEAVE SILENTLY ─────────────────────────────────────────────────────────
 * `onLeave` is the builder's canonical unsaved-changes guard, threaded down to every control
 * here that can leave: the account menu's four destinations, its Log out, and the cart drawer's
 * View cart and Checkout. Opening either overlay is NOT leaving, so neither opening triggers it.
 * This header holds no dirty state of its own — it asks the builder, which owns the only copy.
 */

export default function BuilderHeader({
  identityEmail,
  identityName,
  saving,
  exiting,
  onSaveExit,
  onLeave,
  onSignOut,
}: {
  identityEmail: string;
  identityName?: string | null;
  saving: boolean;
  exiting: boolean;
  onSaveExit: () => void;
  /** Navigate away from the builder, through the canonical unsaved-changes guard. */
  onLeave: (href: string) => void;
  /** Sign out, through the same guard — leaving the builder by any other name. */
  onSignOut: () => void;
}) {
  const { count: cartCount } = useCart();
  const identity = accountIdentity(identityEmail, identityName);

  return (
    <header className="sticky top-0 z-40 flex h-[72px] flex-none items-center gap-4 border-b border-border/70 bg-background/90 px-4 shadow-[0_1px_0_rgb(16_24_20/0.04),0_8px_24px_-20px_rgb(16_24_20/0.25)] backdrop-blur-md sm:px-6">
      {/*
        Brand. It is a LINK to the dashboard, so it leaves the builder — and it is therefore
        guarded like everything else here rather than being the one door left open.
      */}
      <Link
        href="/dashboard"
        onClick={(e) => {
          e.preventDefault();
          onLeave('/dashboard');
        }}
        className="group flex flex-none items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
      >
        <Image
          src="/logo.png"
          alt=""
          width={447}
          height={558}
          priority
          unoptimized
          className="h-8 w-auto transition-transform duration-200 ease-glide group-hover:scale-105"
        />
        <span className="hidden flex-col leading-none sm:flex">
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">Malnad Stories</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Album studio</span>
        </span>
      </Link>

      {/*
        Progress — absolutely centred so the brand/account widths never shift it.
        The builder IS the second step ("Upload & Build"): you cannot reach it without an
        album, so step one is always behind you. The album's draft/submitted status is
        surfaced by the builder's own submit/review UI, not by this bar.
      */}
      <WizardProgress
        current={LAST_WIZARD_STEP}
        tone="studio"
        className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 md:flex"
      />

      {/* Save & exit · Cart · Account */}
      <div className="ml-auto flex flex-none items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onSaveExit}
          disabled={saving || exiting}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-xs transition-all duration-150 ease-glide hover:bg-secondary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-60"
        >
          {exiting ? <InlineLoader /> : null}
          <span className="hidden sm:inline">Save &amp; exit</span>
          <span className="sm:hidden">Save</span>
        </button>

        <CartDrawer count={cartCount} onLeave={onLeave} />

        <AccountMenu
          identity={identity}
          context="app"
          tone="studio"
          onNavigate={(href) => {
            onLeave(href);
            return true; // handled — the guard owns the navigation from here
          }}
          onSignOut={() => {
            onSignOut();
            return true;
          }}
        />
      </div>
    </header>
  );
}
