'use client';

import type * as React from 'react';
import Link from 'next/link';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, LogOut, User } from 'lucide-react';
import { signOut } from '@/lib/actions/auth';
import { accountInitial, type AccountIdentity } from '@/lib/auth/identity';
import { accountMenuLinks, type AccountContext } from './account-menu-model';

/**
 * THE ACCOUNT CONTROL — ONE component, two contexts, every header.
 *
 * The public masthead and the app header render this same file; the only thing that differs is
 * the `context` prop, which decides what the menu offers (see `account-menu-model.ts`). There is
 * no second account menu to keep in step, and no per-surface copy of the identity block.
 *
 * ── WHY BASE UI'S MENU ─────────────────────────────────────────────────────────────────────
 * `@base-ui/react` is already this project's component primitive (shadcn@4 is built on it, and
 * `ui/button.tsx` and `ui/input.tsx` import from it), so this adds NO dependency. What it buys is
 * the part of a menu that is genuinely hard and genuinely dangerous to hand-roll: `role="menu"`
 * semantics, roving focus with arrow keys and type-ahead, Escape, outside-click dismissal, focus
 * return to the trigger, scroll-lock-free positioning, collision handling, and — crucially here —
 * it keeps the popup MOUNTED through its exit transition, which is what makes a closing animation
 * possible at all in CSS. Writing that by hand would be a hundred lines of accessibility to get
 * subtly wrong.
 *
 * ── WHY THE MOTION IS CSS ──────────────────────────────────────────────────────────────────
 * No animation library is installed and none is added. Base UI stamps `data-starting-style` and
 * `data-ending-style` on the popup either side of its transition; the whole choreography hangs off
 * those two attributes in `globals.css` (`.ms-account-*`), using the project's own
 * `--ease-premium` / `--ease-glide` and honouring `prefers-reduced-motion` explicitly.
 *
 * ── INTERPOSING ON NAVIGATION (`onNavigate` / `onSignOut`) ─────────────────────────────────
 * Both are OPTIONAL and both default to nothing, so every existing surface behaves exactly as
 * before: the rows are ordinary anchors and Log out is an ordinary form submit.
 *
 * They exist for ONE caller — the album builder, which holds unsaved work and may not let any
 * control leave the page without asking first. Returning `true` means "I have taken this over";
 * the anchor's navigation and the form's submit are then prevented, and the builder's canonical
 * unsaved-changes guard decides what happens. That is what keeps this the ONLY account menu:
 * the builder gets its guard without a second copy of the identity block, the destinations, the
 * hover treatment or the motion — and every other surface pays nothing for it.
 *
 * ── WHAT IT KNOWS ABOUT THE USER ───────────────────────────────────────────────────────────
 * A name and an email, resolved SERVER-SIDE by whichever layout already holds the authenticated
 * user (`AccountIdentity`). No session, no id, no token, no client-side auth read, and no extra
 * query — the values were already in hand. Signing out calls the EXISTING `signOut` server
 * action; there is no second logout path.
 */
export default function AccountMenu({
  identity,
  context,
  tone = 'brand',
  size = 'default',
  onNavigate,
  onSignOut,
}: {
  identity: AccountIdentity;
  context: AccountContext;
  /**
   * The trigger's footprint. `default` is 44x44 — the size every surface has always used, and
   * the one the app header and the builder keep. `lg` is 48x48 with a 20px glyph from `lg` up,
   * falling back to 44x44 below it: it is for the public masthead, where the account control
   * sits beside "Explore designs" and must match whichever of that button's two steps is on
   * screen. Presentation only: same button, same menu, same behaviour, 44px minimum either way.
   */
  size?: 'default' | 'lg';
  /**
   * Which accent the trigger's focus ring and open state wear. `studio` is the album builder's
   * own interaction green (`--studio-bright`), which every other control in that header already
   * uses; `brand` is the forest ring the rest of the app uses. Presentation only.
   */
  tone?: 'brand' | 'studio';
  /** Return `true` to take over a destination — see the note above. */
  onNavigate?: (href: string) => boolean;
  /** Return `true` to take over signing out. */
  onSignOut?: () => boolean;
}) {
  const links = accountMenuLinks(context);
  const initial = accountInitial(identity);

  return (
    <Menu.Root>
      {/*
        THE TRIGGER. A real <button> with an accessible name — Base UI adds `aria-haspopup`,
        `aria-expanded` and `aria-controls`, so the state is announced rather than implied by a
        colour. 44x44, or 48x48 from `lg` up on the public masthead (`size="lg"`) — both clear
        the touch minimum on every viewport.

        Three states, each doing one job: hover warms the surface, `aria-expanded` (open) holds a
        deeper ring so the menu is visibly anchored to the thing that opened it, and the press
        scales fractionally so a tap feels like a press. Nothing bounces.
      */}
      <Menu.Trigger
        aria-label={`Account — ${identity.name}`}
        className={`ms-account-trigger grid ${
          size === 'lg' ? 'h-11 w-11 lg:h-12 lg:w-12' : 'h-11 w-11'
        } place-items-center rounded-full border border-border bg-card text-primary outline-none transition-[background-color,border-color,transform] duration-150 ease-glide hover:border-primary/40 hover:bg-secondary active:scale-[0.97] aria-expanded:border-primary/45 aria-expanded:bg-secondary ${
          tone === 'studio'
            ? 'focus-visible:ring-2 focus-visible:ring-studio-bright'
            : 'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background'
        }`}
      >
        <User
          className={`ms-account-trigger-icon ${
            size === 'lg' ? 'h-[18px] w-[18px] lg:h-5 lg:w-5' : 'h-[18px] w-[18px]'
          }`}
          aria-hidden
        />
      </Menu.Trigger>

      <Menu.Portal>
        {/*
          `align="end"` puts the panel's right edge under the trigger's, so it opens INTO the page
          rather than off the edge of it; `sideOffset` leaves a hairline of background between the
          bar and the panel so the panel reads as sitting above it.
        */}
        <Menu.Positioner side="bottom" align="end" sideOffset={10} className="z-50">
          <Menu.Popup className="ms-account-popup w-[268px] overflow-hidden rounded-md border border-border bg-card shadow-elevated outline-none">
            {/*
              ── THE IDENTITY PLATE ────────────────────────────────────────────────────────
              A block of forest at the top of a warm paper card — the same pairing the command
              rail already uses (`bg-primary-deep` ground, `bg-primary-light` avatar well,
              gold-pale initial). It gives the panel a face and an obvious top, and it is the ONE
              emphatic thing here; everything below it is deliberately quiet.

              INFORMATIONAL ONLY. A name and an address. No settings link, no plan, no avatar
              upload, no "manage account" — none of which exists in this product.
            */}
            <div className="ms-account-plate flex items-center gap-3 bg-primary-deep px-4 py-3.5">
              <span
                aria-hidden
                className="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary-light font-display text-[15px] leading-none text-gold-pale"
              >
                {initial}
              </span>
              <span className="min-w-0">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.22em] text-gold-pale/70">
                  Account
                </span>
                <span className="mt-1 block truncate font-display text-[15px] leading-tight text-primary-foreground">
                  {identity.name}
                </span>
                {identity.email && (
                  <span className="block truncate text-[11px] leading-tight text-primary-foreground/50">
                    {identity.email}
                  </span>
                )}
              </span>
            </div>

            {/*
              ── NAVIGATION ────────────────────────────────────────────────────────────────
              Real anchors (`Menu.LinkItem` renders an `<a>`, and `render` hands it to next/link),
              so they are middle-clickable, copyable and announced as links. `closeOnClick`
              dismisses the panel as the navigation starts.
            */}
            <div className="ms-account-rows p-1.5">
              {links.map((link, i) => (
                <Menu.LinkItem
                  key={link.href}
                  closeOnClick
                  render={<Link href={link.href} />}
                  /*
                    The host may take the destination over (the builder does, to run its
                    unsaved-changes guard). Preventing the default stops the anchor navigating;
                    `closeOnClick` still dismisses the menu, so the guard's dialog is never
                    opened underneath an open menu.
                  */
                  onClick={(event: React.MouseEvent) => {
                    if (onNavigate?.(link.href)) event.preventDefault();
                  }}
                  style={{ ['--i' as string]: i }}
                  className="ms-account-row group/row flex select-none items-center gap-3 rounded-sm px-2.5 py-2 text-[13px] leading-none text-foreground outline-none transition-colors duration-150 ease-glide data-[highlighted]:bg-secondary"
                >
                  <link.icon className="h-[15px] w-[15px] flex-none text-muted-foreground transition-colors duration-150 group-hover/row:text-primary group-data-[highlighted]/row:text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{link.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-none text-muted-foreground">{link.hint}</span>
                  </span>
                  {/*
                    The affordance. It is the only thing that moves on hover — a 3px slide and a
                    fade from near-invisible — so the row communicates "this goes somewhere"
                    without the text shifting under the reader's eye.
                  */}
                  <ChevronRight
                    className="ms-account-chevron h-3.5 w-3.5 flex-none text-muted-foreground/45"
                    aria-hidden
                  />
                </Menu.LinkItem>
              ))}
            </div>

            <Menu.Separator className="mx-1.5 h-px bg-border" />

            {/*
              ── SIGN OUT ──────────────────────────────────────────────────────────────────
              THE EXISTING ACTION, IN THE EXISTING SHAPE: a `<form action={signOut}>`, exactly as
              `app-header.tsx` has always submitted it. No second logout, no client-side session
              clearing, no navigation of our own — `signOut` invalidates the Supabase session and
              redirects to `/`, which re-renders every header from the server and is why the bar
              returns to its signed-out state with no stale UI left behind.

              Set apart by the rule above and by weight, never by alarm colour: signing out is
              routine, not destructive.
            */}
            {/*
              Signing out is leaving, so the host may take it over too — same contract, same
              reason. Untouched when it does not: the form still submits the existing action.
            */}
            <form
              action={signOut}
              onSubmit={(event) => {
                if (onSignOut?.()) event.preventDefault();
              }}
              className="p-1.5"
            >
              <Menu.Item
                closeOnClick
                style={{ ['--i' as string]: links.length }}
                render={<button type="submit" />}
                className="ms-account-row group/row flex w-full select-none items-center gap-3 rounded-sm px-2.5 py-3 text-left text-[13px] leading-none text-muted-foreground outline-none transition-colors duration-150 ease-glide data-[highlighted]:bg-secondary data-[highlighted]:text-foreground"
              >
                <LogOut className="h-[15px] w-[15px] flex-none" aria-hidden />
                <span className="flex-1 font-medium">Log out</span>
              </Menu.Item>
            </form>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
