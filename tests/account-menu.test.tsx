/**
 * THE ACCOUNT MENU — one control, two contexts.
 *
 * ── WHAT IS ASSERTED HERE, AND HOW ────────────────────────────────────────────────────────────
 *
 * Two layers, deliberately:
 *
 *   · THE MODEL (`account-menu-model.ts`) is pure, so the contexts are tested as data: which
 *     destinations each one offers, in which order, and — the two rules the brief is specifically
 *     about — that the app context does NOT re-offer the dashboard, and that neither context
 *     invents a route.
 *   · THE RENDERED MENU is produced with `react-dom/server` and Base UI's Menu parts stubbed to
 *     pass-through elements, which is what makes the popup's contents inspectable without a DOM.
 *     The identity block, every href, the logout form and the trigger's accessible name are then
 *     assertions about real markup rather than about source text.
 *
 * ── WHAT IS *NOT* ASSERTED HERE, AND WHY ──────────────────────────────────────────────────────
 *
 * Opening, closing, Escape, outside-click, arrow-key roving and focus return are **owned by
 * `@base-ui/react`'s Menu**, not by this code — that is precisely why the primitive was used
 * instead of a hand-rolled popover. This suite runs on `environment: 'node'` with no DOM (see
 * `vitest.config.ts`), so those interactions cannot be driven here, and adding jsdom +
 * testing-library would mean new dependencies. What IS pinned is that the behaviours are
 * delegated to the primitive at all — the trigger/portal/positioner/popup composition, and
 * `closeOnClick` on every item — so a future refactor to a bespoke div-with-onClick would fail.
 * The interactions themselves were exercised in a real browser; see the phase report.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Base UI's Menu, reduced to its structure. Every part keeps its identity as a `data-part`, so
 * the composition itself is assertable, and `render` (the project's `asChild`) is honoured
 * exactly as the real primitive honours it — which is what lets the link items come out as real
 * anchors here, as they do in the browser.
 */
vi.mock('@base-ui/react/menu', () => {
  type P = Record<string, unknown> & { children?: React.ReactNode; render?: React.ReactElement };
  const part =
    (name: string, tag: string) =>
    ({ children, render, ...rest }: P) => {
      if (render) return React.cloneElement(render, { 'data-part': name, ...rest }, children);
      return React.createElement(tag, { 'data-part': name, ...rest }, children);
    };
  return {
    Menu: {
      Root: part('root', 'div'),
      Trigger: part('trigger', 'button'),
      Portal: part('portal', 'div'),
      Positioner: part('positioner', 'div'),
      Popup: part('popup', 'div'),
      Item: part('item', 'div'),
      LinkItem: part('link-item', 'a'),
      Separator: part('separator', 'hr'),
    },
  };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('@/lib/actions/auth', () => ({ signOut: async () => {} }));

// Static imports are safe: Vitest hoists every vi.mock() above them.
import AccountMenu from '@/components/account/account-menu';
import { accountMenuLinks, ACCOUNT_MENU_HAS_SIGN_OUT, type AccountContext } from '@/components/account/account-menu-model';
import { accountIdentity, accountInitial } from '@/lib/auth/identity';

const IDENTITY = { name: 'Anita Rao', email: 'anita@example.com' };

function render(context: AccountContext, identity = IDENTITY) {
  const html = renderToStaticMarkup(React.createElement(AccountMenu, { identity, context }));
  const hrefs = Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, hrefs, text };
}

// ── THE MODEL ────────────────────────────────────────────────────────────────────────────────

describe('the menu offers what the current context does not already', () => {
  it('PUBLIC → the way in: the dashboard and the cart', () => {
    expect(accountMenuLinks('public').map((l) => l.href)).toEqual(['/dashboard', '/cart']);
  });

  it('APP → the way back out: home, stories, contact', () => {
    expect(accountMenuLinks('app').map((l) => l.href)).toEqual(['/', '/stories', '/contact']);
  });

  it('never re-offers the dashboard to someone already inside it', () => {
    expect(accountMenuLinks('app').map((l) => l.href)).not.toContain('/dashboard');
  });

  it('offers no cart in the app context — the rail already carries it', () => {
    expect(accountMenuLinks('app').map((l) => l.href)).not.toContain('/cart');
  });

  it('invents no route — every destination is one that already shipped', () => {
    const EXISTING = ['/', '/stories', '/contact', '/dashboard', '/cart'];
    for (const context of ['public', 'app'] as AccountContext[]) {
      for (const link of accountMenuLinks(context)) expect(EXISTING).toContain(link.href);
    }
  });

  it('gives every row a label and an orienting line — never a ragged half-set', () => {
    for (const context of ['public', 'app'] as AccountContext[]) {
      for (const link of accountMenuLinks(context)) {
        expect(link.label.length).toBeGreaterThan(0);
        expect(link.hint.length).toBeGreaterThan(0);
        expect(typeof link.icon).not.toBe('undefined');
      }
    }
  });
});

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────

describe('account information', () => {
  it('prefers the display name', () => {
    expect(accountIdentity('anita@example.com', 'Anita Rao')).toEqual(IDENTITY);
  });

  it('falls back to the email local part when there is no name', () => {
    expect(accountIdentity('anita@example.com', null).name).toBe('anita');
    expect(accountIdentity('anita@example.com', '   ').name).toBe('anita');
  });

  it('falls back again rather than rendering a blank line', () => {
    expect(accountIdentity('', null).name).toBe('Your account');
    expect(accountIdentity(null, null).name).toBe('Your account');
  });

  it('rejects a name the identity policy would not have stored', () => {
    // `validateName` is the same rule /auth/callback applies before writing profiles.name.
    expect(accountIdentity('anita@example.com', '<script>x</script>').name).toBe('anita');
  });

  it('derives the avatar initial the way the command rail always has', () => {
    expect(accountInitial(IDENTITY)).toBe('A');
    expect(accountInitial(accountIdentity('zoe@example.com', null))).toBe('Z');
  });

  it('shows the name and the address, and nothing else about the session', () => {
    const { text, html } = render('public');
    expect(text).toContain('Anita Rao');
    expect(text).toContain('anita@example.com');
    expect(text).toContain('Account');
    // No id, no token, no role, no raw user object anywhere in the markup.
    for (const leak of ['user_metadata', 'access_token', 'session', 'role', 'aud']) {
      expect(html).not.toContain(leak);
    }
  });
});

// ── THE RENDERED MENU ────────────────────────────────────────────────────────────────────────

describe('the public-context menu', () => {
  it('renders the account block, both destinations and sign out', () => {
    const { hrefs, text } = render('public');
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/cart');
    expect(text).toContain('Log out');
  });

  it('reaches the dashboard and the cart as REAL anchors', () => {
    const { html } = render('public');
    expect(html).toMatch(/<a[^>]*href="\/dashboard"/);
    expect(html).toMatch(/<a[^>]*href="\/cart"/);
  });
});

describe('the app-context menu', () => {
  it('renders the public destinations, and no dashboard link', () => {
    const { hrefs, text } = render('app');
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/stories', '/contact']));
    expect(hrefs).not.toContain('/dashboard');
    expect(text).toContain('Home');
    expect(text).toContain('Stories');
    expect(text).toContain('Contact & FAQ');
  });

  it('KEEPS sign out — the app header was the only way to sign out of the product', () => {
    // A deliberate, documented departure from the brief: `/account`, the rail and the sidebar
    // have no logout, so a menu without it would strand a signed-in customer.
    expect(ACCOUNT_MENU_HAS_SIGN_OUT).toBe(true);
    expect(render('app').text).toContain('Log out');
  });

  it('shows the same account block as the public menu — one component, one identity', () => {
    const { text } = render('app');
    expect(text).toContain('Anita Rao');
    expect(text).toContain('anita@example.com');
  });
});

describe('both contexts share one implementation', () => {
  it('differ ONLY in their navigation rows', () => {
    // The rows differ — and so does the sign-out row's stagger index, which counts from however
    // many rows precede it. Both are normalised away; everything else must match exactly.
    const strip = (h: string) =>
      h.replace(/<a[^>]*data-part="link-item"[\s\S]*?<\/a>/g, '').replace(/ style="[^"]*"/g, '');
    expect(strip(render('app').html)).toBe(strip(render('public').html));
  });

  it('the trigger is a labelled button, 44x44, in both', () => {
    for (const context of ['public', 'app'] as AccountContext[]) {
      const { html } = render(context);
      const trigger = /<button[^>]*data-part="trigger"[^>]*>/.exec(html)?.[0] ?? '';
      expect(trigger).toContain('aria-label="Account — Anita Rao"');
      expect(trigger).toContain('h-11');
      expect(trigger).toContain('w-11');
      expect(trigger).toContain('focus-visible:ring-2');
    }
  });

  it('the email is inside the popup, never printed in the bar', () => {
    const { html } = render('public');
    const trigger = /<button[^>]*data-part="trigger"[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
    expect(trigger).not.toContain('anita@example.com');
  });
});

// ── DELEGATION, LOGOUT AND MOTION ────────────────────────────────────────────────────────────

describe('behaviour is delegated to the existing primitives, not re-implemented', () => {
  const menu = src('src/components/account/account-menu.tsx');

  it('composes Base UI’s Menu — which owns Escape, outside click, roving focus and focus return', () => {
    expect(menu).toContain("from '@base-ui/react/menu'");
    for (const part of ['Menu.Root', 'Menu.Trigger', 'Menu.Portal', 'Menu.Positioner', 'Menu.Popup']) {
      expect(menu).toContain(part);
    }
    // No hand-rolled dismissal: those are exactly the bugs the primitive exists to prevent.
    for (const bad of ['document.addEventListener', 'onKeyDown', 'useOnClickOutside', 'onBlur']) {
      expect(menu).not.toContain(bad);
    }
  });

  it('closes when an item is chosen', () => {
    // Every item — the link rows and the sign-out row — dismisses the menu on activation, each
    // carrying the prop explicitly rather than relying on a primitive's default.
    expect(menu).toMatch(/<Menu\.LinkItem[\s\S]{0,240}closeOnClick/);
    expect(menu).toMatch(/<Menu\.Item[\s\S]{0,240}closeOnClick/);
  });

  it('uses the EXISTING signOut action, submitted the way this codebase submits it', () => {
    expect(menu).toContain("import { signOut } from '@/lib/actions/auth'");
    expect(menu).toContain('<form action={signOut}');
    expect(render('public').html).toMatch(/<button[^>]*type="submit"/);
    // No second logout: no client-side session clearing, no bespoke redirect.
    for (const bad of ['signOut()', 'router.push', 'supabase.auth', 'localStorage']) {
      expect(menu).not.toContain(bad);
    }
  });

  it('adds no animation dependency — the choreography is the project’s own CSS', () => {
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    for (const bad of ['framer-motion', 'motion', '@radix-ui/react-dropdown-menu', 'react-popper']) {
      expect(pkg.dependencies[bad]).toBeUndefined();
    }
    expect(menu).toContain('ms-account-popup');

    const css = src('src/app/globals.css');
    // Enter, exit and stagger all hang off Base UI's transition attributes.
    expect(css).toContain('.ms-account-popup[data-starting-style]');
    expect(css).toContain('.ms-account-popup[data-ending-style]');
    expect(css).toContain('@keyframes ms-account-in');
    // Only transform + opacity are animated, and the project's own easings are used.
    expect(css).toContain('var(--ease-premium)');
    expect(css).toContain('var(--ease-glide)');
    expect(css).not.toMatch(/\.ms-account-[a-z-]*\s*\{[^}]*transition:[^}]*\b(width|height|top|left|margin)\b/);
    // Origin-aware: it grows out of the trigger's corner, not the centre.
    expect(css).toContain('transform-origin: top right');
  });

  it('the exit is faster than the entrance', () => {
    const css = src('src/app/globals.css');
    const enter = Number(/opacity (\d+)ms var\(--ease-premium\)/.exec(css)?.[1]);
    const exit = Number(/opacity (\d+)ms var\(--ease-glide\)/.exec(css)?.[1]);
    expect(enter).toBeGreaterThan(0);
    expect(exit).toBeLessThan(enter);
    expect(enter).toBeLessThanOrEqual(300); // functional transition budget
  });

  it('reduced motion keeps the menu, drops the movement, and clears the stagger DELAY', () => {
    const css = src('src/app/globals.css');
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/g;
    const reduced = Array.from(css.matchAll(block)).map((m) => m[0]).filter((b) => b.includes('ms-account'));
    expect(reduced.length).toBe(1);
    // The global rule collapses DURATIONS but not delays — a staggered, `both`-filled row would
    // otherwise sit invisible. Both the animation and the transforms are dropped explicitly.
    expect(reduced[0]).toContain('.ms-account-row');
    expect(reduced[0]).toContain('animation: none');
    expect(reduced[0]).toContain('transform: none');
    // …and the menu is still there. Never `display: none`.
    expect(reduced[0]).not.toContain('display: none');
  });
});
