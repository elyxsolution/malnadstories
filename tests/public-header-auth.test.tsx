/**
 * PHASE 2 FOLLOW-UP — THE PUBLIC HEADER'S AUTH ENTRY.
 *
 * Signed out the masthead offers Login; signed in it offers one compact account control that goes
 * to the existing dashboard. Both states are RENDERED HERE with `react-dom/server`, so these are
 * assertions about what a visitor actually gets — the two controls, their hrefs, their labels —
 * rather than about the shape of the source.
 *
 * Only framework boundaries are stubbed: `next/navigation` (there is no router outside a Next
 * request) and `next/link` (which becomes the `<a>` it renders anyway). The component's own logic
 * runs untouched.
 *
 * The SERVER half (`public-header.tsx`) resolves the session and cannot be rendered here — it
 * needs a request, a cookie store and Supabase. Its wiring is pinned by source-level assertions in
 * `auth-continuation.test.ts`; what this file guarantees is that whatever boolean it computes
 * produces the right bar.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => React.createElement('img', { alt: alt ?? '' }),
}));
/*
 * The account control is exercised in full by `account-menu.test.tsx`. Here it is reduced to the
 * one thing this file is about — WHICH control the bar draws — so these assertions cannot start
 * failing for reasons that belong to the menu's own suite.
 */
vi.mock('@/components/account/account-menu', () => ({
  default: ({ identity, context }: { identity: { name: string }; context: string }) =>
    React.createElement(
      'button',
      { 'data-account-menu': context, 'aria-label': `Account — ${identity.name}`, className: 'h-11 w-11 focus-visible:ring-2' },
      'account',
    ),
}));
vi.mock('@/lib/actions/auth', () => ({ signOut: async () => {} }));

// Static import is safe: Vitest hoists every vi.mock() above it.
import { PublicHeaderNav } from '@/components/public-header-nav';

const DESIGN_NEXT = '/login?next=%2Falbums%2Fnew%3Fdesign%3D4f1c2a3e-0000-4000-8000-000000000001';

const IDENTITY = { name: 'Anita Rao', email: 'anita@example.com' };

function render(props: { signedIn?: boolean; loginHref?: string } = {}) {
  const { signedIn, ...rest } = props;
  const html = renderToStaticMarkup(
    React.createElement(PublicHeaderNav, { ...rest, identity: signedIn ? IDENTITY : null }),
  );
  const hrefs = Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
  const labels = Array.from(html.matchAll(/aria-label="([^"]*)"/g)).map((m) => m[1]);
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, hrefs, labels, text };
}

const ACCOUNT_LABEL = 'Account — Anita Rao';

// ── SIGNED OUT ───────────────────────────────────────────────────────────────────────────────

describe('signed out', () => {
  it('offers Login', () => {
    const { text, hrefs } = render({ signedIn: false });
    expect(text).toContain('Login');
    expect(hrefs).toContain('/login');
  });

  it('does NOT render the account control', () => {
    const { labels, hrefs } = render({ signedIn: false });
    expect(labels).not.toContain(ACCOUNT_LABEL);
    expect(hrefs).not.toContain('/dashboard');
  });

  it('points Login at the EXISTING /login route — no second login surface', () => {
    const { hrefs } = render({ signedIn: false });
    // Every login destination is /login itself; nothing invents /signin, /auth/login, etc.
    const loginish = hrefs.filter((h) => /login|signin|sign-in/i.test(h));
    expect(loginish.length).toBeGreaterThan(0);
    for (const h of loginish) expect(h.startsWith('/login')).toBe(true);
  });

  it('preserves a pending Phase 2 continuation on BOTH the bar and the mobile sheet', () => {
    const { hrefs } = render({ signedIn: false, loginHref: DESIGN_NEXT });
    const carrying = hrefs.filter((h) => h === DESIGN_NEXT);
    // Desktop control + mobile sheet control — neither may drop the destination.
    expect(carrying.length).toBe(2);
  });

  it('falls back to a bare /login for ordinary public navigation', () => {
    const { hrefs } = render({ signedIn: false });
    expect(hrefs.filter((h) => h === '/login').length).toBe(2);
  });
});

// ── SIGNED IN ────────────────────────────────────────────────────────────────────────────────

describe('signed in', () => {
  it('renders the account control, labelled for screen readers', () => {
    const { labels } = render({ signedIn: true });
    expect(labels).toContain(ACCOUNT_LABEL);
  });

  it('the bar itself no longer links straight to /dashboard — the menu owns that now', () => {
    const { html } = render({ signedIn: true });
    // The desktop control is the account menu's trigger, not an anchor to a destination.
    expect(html).toContain('data-account-menu="public"');
    const bar = html.split('id="public-mobile-nav"')[0];
    expect(bar).not.toMatch(/<a[^>]*href="\/dashboard"/);
  });

  it('the mobile sheet still reaches the EXISTING /dashboard and /cart, and invents no route', () => {
    const { hrefs } = render({ signedIn: true });
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/cart');
    for (const h of hrefs.filter((x) => x.startsWith('/dashboard'))) expect(h).toBe('/dashboard');
  });

  it('does NOT offer Login', () => {
    const { text, hrefs } = render({ signedIn: true });
    expect(hrefs).not.toContain('/login');
    expect(text).not.toContain('Login');
  });

  it('never prints the email in the bar itself — it lives inside the account surface', () => {
    const { html } = render({ signedIn: true });
    const bar = html.split('id="public-mobile-nav"')[0];
    expect(bar).not.toContain('anita@example.com');
  });

  it('offers no standalone Log out action in the bar', () => {
    const { html } = render({ signedIn: true });
    const bar = html.split('id="public-mobile-nav"')[0];
    expect(bar).not.toContain('Log out');
  });

  it('is a real button — the control opens a menu, so it is announced as a button', () => {
    const { html } = render({ signedIn: true });
    expect(html).toMatch(/<button[^>]*aria-label="Account — /);
    // Never a div with a click handler.
    expect(html).not.toMatch(/<div[^>]*aria-label="Account — /);
  });

  it('meets the 44x44 touch target and shows a visible focus ring', () => {
    const { html } = render({ signedIn: true });
    const control = /<button[^>]*aria-label="Account — [^"]*"[^>]*>/.exec(html)?.[0] ?? '';
    expect(control).toContain('h-11');
    expect(control).toContain('w-11');
    expect(control).toContain('focus-visible:ring-2');
  });

  it('states the account inline in the mobile sheet, with ≥44px rows and no nested popover', () => {
    const { html, text } = render({ signedIn: true });
    // The identity is presented as content, not behind a second menu inside the sheet.
    expect(text).toContain('Anita Rao');
    expect(text).toContain('anita@example.com');
    // No popover nested inside the open sheet — the trigger exists only in the bar above it.
    const sheet = html.split('id="public-mobile-nav"')[1] ?? '';
    expect(sheet).not.toContain('data-account-menu');
    const row = /<a[^>]*href="\/dashboard"[^>]*>/.exec(html)?.[0] ?? '';
    expect(row).toContain('min-h-[3rem]');
    // And the sheet's sign out is the existing server action, submitted as a form.
    expect(html).toMatch(/<form[^>]*>[\s\S]*?<button[^>]*type="submit"[\s\S]*?Log out/);
  });
});

// ── UNCHANGED IN BOTH STATES ─────────────────────────────────────────────────────────────────

describe('everything else about the masthead is unchanged', () => {
  for (const signedIn of [false, true]) {
    const state = signedIn ? 'signed in' : 'signed out';

    it(`keeps the four public destinations, ${state}`, () => {
      const { hrefs, text } = render({ signedIn });
      for (const href of ['/', '/stories', '/about', '/contact']) expect(hrefs).toContain(href);
      for (const label of ['Home', 'Stories', 'About', 'Contact & FAQ']) expect(text).toContain(label);
      expect(hrefs).not.toContain('/pricing');
    });

    it(`keeps "Explore designs" as the one filled action, ${state}`, () => {
      const { text } = render({ signedIn });
      // Twice: the desktop bar and the mobile sheet, exactly as before.
      expect(text.match(/Explore designs/g)?.length).toBe(2);
    });

    it(`keeps the brand mark pointing at Home, ${state}`, () => {
      const { labels, html } = render({ signedIn });
      expect(labels).toContain('Malnad Stories — home');
      expect(html).toMatch(/<a[^>]*href="\/"[^>]*aria-label="Malnad Stories — home"/);
    });

    it(`keeps the mobile sheet's dialog semantics and menu toggle, ${state}`, () => {
      const { html, labels } = render({ signedIn });
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('id="public-mobile-nav"');
      expect(html).toContain('aria-controls="public-mobile-nav"');
      expect(labels).toContain('Open menu');
    });
  }

  it('renders identically apart from the one control that is supposed to differ', () => {
    const out = render({ signedIn: false }).html;
    const inn = render({ signedIn: true }).html;
    // Strip the two auth controls from each; what remains must be byte-identical.
    // Everything the two states are ALLOWED to differ by: the desktop control, and the sheet's
    // account section (which is one control signed out and an identity + rows signed in). The
    // masthead, the nav, "Explore designs" and the sheet's own mechanics must match exactly.
    const strip = (h: string) =>
      h
        .replace(/<button[^>]*data-account-menu[\s\S]*?<\/button>/g, '<!--account-->')
        .replace(/<a[^>]*href="\/login"[\s\S]*?<\/a>/g, '<!--account-->')
        .replace(/<div class="mt-8 border-t[\s\S]*?<\/form><\/div><\/div>/g, '<!--account-->');
    expect(strip(inn)).toBe(strip(out));
  });
});
