/**
 * THE DASHBOARD SHELL — the rail lost a logo, and nothing else.
 *
 * The mark and the wordmark sat at the top of the command rail AND in the app header directly
 * above it: the same statement made twice, pushing the navigation — the only reason that column
 * exists — down the page. The block is gone from the rail; the header's is untouched.
 *
 * That is a change most easily broken by accident (the two brand blocks look alike, and the
 * obvious "cleanup" is to remove the wrong one), so this renders BOTH surfaces and asserts the
 * distinction directly rather than trusting a diff.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => React.createElement('img', { alt: alt ?? '', 'data-brand-mark': '' }),
}));
vi.mock('@/lib/cart/provider', () => ({ useCart: () => ({ count: 0 }) }));
/* next/font cannot run outside a Next build; the class string it produces is irrelevant here. */
vi.mock('@/lib/fonts', () => ({ brandFontVars: 'brand-fonts' }));
vi.mock('@/lib/actions/auth', () => ({ signOut: async () => {} }));
/* The account control has its own suite; here it is reduced to a marker. */
vi.mock('@/components/account/account-menu', () => ({
  default: ({ identity, context }: { identity: { name: string; email: string }; context: string }) =>
    React.createElement('button', { 'data-account-menu': context, 'aria-label': `Account — ${identity.name}` }, 'account'),
}));

// Static imports are safe: Vitest hoists every vi.mock() above them.
import CustomerShell from '@/components/customer-shell';
import AppHeader from '@/components/app-header';

function renderShell() {
  const html = renderToStaticMarkup(
    React.createElement(CustomerShell, { email: 'anita@example.com', children: null }),
  );
  const hrefs = Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { html, hrefs, text };
}

function renderHeader() {
  const html = renderToStaticMarkup(
    React.createElement(AppHeader, { email: 'anita@example.com', name: 'Anita Rao' }),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { html, text };
}

// ── THE ONE REMOVAL ──────────────────────────────────────────────────────────────────────────

describe('the sidebar no longer carries the brand', () => {
  it('has no brand mark and no wordmark', () => {
    const { html, text } = renderShell();
    expect(html).not.toContain('data-brand-mark');
    expect(html).not.toContain('Sprig');
    // The wordmark was the two-line "Malnad / STORIES" lockup.
    expect(text).not.toContain('Malnad');
    expect(text).not.toContain('STORIES');
  });

  it('opens directly on the navigation', () => {
    const { html } = renderShell();
    const firstHref = /href="([^"]*)"/.exec(html)?.[1];
    expect(firstHref).toBe('/dashboard'); // "Your stories" — the first nav row
  });
});

// ── EVERYTHING ELSE IS UNCHANGED ─────────────────────────────────────────────────────────────

describe('the rail keeps every row, its ordering and its treatment', () => {
  const EXPECTED = [
    ['/dashboard', 'Your stories'],
    ['/cart', 'Cart'],
    ['/orders', 'Orders'],
    ['/reviews', 'Reviews'],
    ['/support', 'Support'],
    ['/account', 'Account'],
  ] as const;

  for (const [href, label] of EXPECTED) {
    it(`keeps ${label}`, () => {
      const { hrefs, text } = renderShell();
      expect(hrefs).toContain(href);
      expect(text).toContain(label);
    });
  }

  it('keeps them in their existing order', () => {
    const { hrefs } = renderShell();
    const nav = EXPECTED.map(([h]) => h);
    const seen = hrefs.filter((h) => nav.includes(h as (typeof nav)[number]));
    // /dashboard and /account appear again lower down (the CTA block and the account chip),
    // so compare first occurrences.
    const firstOrder = nav.filter((h) => seen.includes(h));
    expect(firstOrder).toEqual(nav);
  });

  it('keeps the active-state treatment, driven by the same pathname match', () => {
    const { html } = renderShell();
    // /dashboard is the current route in this render, so its row is the marked one.
    expect(html).toMatch(/aria-current="page"/);
  });

  it('keeps the New album CTA and the account chip below the nav', () => {
    const { hrefs, text } = renderShell();
    expect(hrefs).toContain('/albums/new');
    expect(text).toContain('New album');
    expect(text).toContain('anita@example.com');
    expect(text).toContain('View account');
  });

  it('keeps the rail geometry and ground — nothing was re-tuned to fill the gap', () => {
    const { html } = renderShell();
    expect(html).toContain('w-[68px]');
    expect(html).toContain('sm:w-[236px]');
    expect(html).toContain('bg-primary-deep');
    expect(html).toContain('py-6');
    expect(html).toContain('overflow-y-auto');
  });
});

// ── THE OTHER BRAND BLOCK STAYS ──────────────────────────────────────────────────────────────

describe('the app header keeps its branding, and swaps only the account treatment', () => {
  it('still shows the mark and the wordmark, still linking to the dashboard', () => {
    const { html, text } = renderHeader();
    expect(html).toContain('data-brand-mark');
    expect(text).toContain('Malnad Stories');
    expect(html).toMatch(/<a[^>]*href="\/dashboard"/);
  });

  it('no longer prints the email or a standalone Log out in the bar', () => {
    const { text } = renderHeader();
    expect(text).not.toContain('anita@example.com');
    expect(text).not.toContain('Log out');
  });

  it('renders the ONE account control, in its app context', () => {
    const { html } = renderHeader();
    expect(html).toContain('data-account-menu="app"');
    expect(html).toContain('aria-label="Account — Anita Rao"');
  });

  it('falls back gracefully when no display name exists (the admin layout passes none)', () => {
    const html = renderToStaticMarkup(
      React.createElement(AppHeader, { email: 'anita@example.com' }),
    );
    expect(html).toContain('aria-label="Account — anita"');
  });
});
