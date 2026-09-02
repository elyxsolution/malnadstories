/**
 * THE BUILDER'S WAY OUT — cart, account, and the promise that unsaved work survives all of it.
 *
 * The invariant is a negative one, which is the hard kind to hold: *no* control that leaves the
 * builder may do so without consulting the canonical dirty state. A negative is only safe if it
 * is checked exhaustively, so the centrepiece of this file is an AUDIT — it walks the builder's
 * own source for every navigation primitive and asserts each one is either guarded or is not an
 * exit at all. A new unguarded `router.push` or `<Link>` added later fails it.
 *
 * WHAT IS ASSERTED BY RENDERING, AND WHAT BY READING. `_builder.tsx` is a ~4000-line orchestrator
 * that needs an album, photos, a Supabase session and a canvas; it cannot be mounted in this
 * suite (`environment: 'node'`, no DOM). Its header CAN be, and is — the controls, their labels,
 * their targets and the absence of the email are assertions about real markup. The guard's
 * SEQUENCING (save → success → navigate, failure → stay) is asserted against the source of the
 * two confirm handlers, because that ordering is the whole requirement and it is expressed in
 * four lines that must not be reordered.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Source with comments stripped — these files explain themselves at length. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const B = 'src/app/(app)/albums/[id]/build/';
const builder = src(`${B}_builder.tsx`);
const header = src(`${B}_header.tsx`);
const drawer = src('src/components/cart/cart-drawer.tsx');
const menu = src('src/components/account/account-menu.tsx');

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt?: string }) => React.createElement('img', { alt: alt ?? '' }),
}));
vi.mock('@/lib/cart/provider', () => ({ useCart: () => ({ count: 2 }) }));
vi.mock('@/lib/actions/auth', () => ({ signOut: async () => {} }));
vi.mock('@/lib/actions/cart', () => ({ getCartOverview: async () => ({ ok: true, rows: [], eligibleCount: 0 }) }));
/* The two overlays have their own suites; here they are markers, so this file asserts WHICH
   controls the header renders and how they are wired, not how they animate. */
vi.mock('@/components/account/account-menu', () => ({
  default: ({ context, tone, onNavigate, onSignOut }: Record<string, unknown>) =>
    React.createElement('button', {
      'data-account-menu': String(context),
      'data-tone': String(tone),
      'data-guarded': String(typeof onNavigate === 'function' && typeof onSignOut === 'function'),
      'aria-label': 'Account — Anita Rao',
      className: 'h-11 w-11',
    }),
}));
vi.mock('@/components/cart/cart-drawer', () => ({
  default: ({ count, onLeave }: Record<string, unknown>) =>
    React.createElement('button', {
      'data-cart-drawer': String(count),
      'data-guarded': String(typeof onLeave === 'function'),
      'aria-label': `Cart — ${count} albums`,
      className: 'h-11 w-11',
    }),
}));

// Static import is safe: Vitest hoists every vi.mock() above it.
import BuilderHeader from '@/app/(app)/albums/[id]/build/_header';

function renderHeader() {
  const html = renderToStaticMarkup(
    React.createElement(BuilderHeader, {
      identityEmail: 'anita@example.com',
      identityName: 'Anita Rao',
      saving: false,
      exiting: false,
      onSaveExit: () => {},
      onLeave: () => {},
      onSignOut: () => {},
    }),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { html, text };
}

// ── THE HEADER ───────────────────────────────────────────────────────────────────────────────

describe('the builder header offers Save & exit, Cart and Account', () => {
  it('renders all three, and each interactive control clears 44px', () => {
    const { html, text } = renderHeader();
    expect(text).toContain('Save & exit');
    expect(html).toContain('data-cart-drawer');
    expect(html).toContain('data-account-menu="app"');
    // Save & exit is a min-height button; the two icon controls are 44x44 squares.
    expect(html).toContain('min-h-11');
    expect(html.match(/h-11 w-11/g)?.length).toBe(2);
  });

  it('no longer prints the email, and offers no standalone Log out', () => {
    const { html, text } = renderHeader();
    expect(html).not.toContain('anita@example.com');
    expect(text).not.toContain('Log out');
    // The old presentation is gone from the source too, not merely hidden.
    expect(code(header)).not.toContain('signOut');
    expect(code(header)).not.toMatch(/\{email\}/);
  });

  it('labels both icon controls for screen readers', () => {
    const { html } = renderHeader();
    expect(html).toContain('aria-label="Cart — 2 albums"');
    expect(html).toContain('aria-label="Account — Anita Rao"');
  });

  it('reuses the ONE account menu, in its app context and the builder’s accent', () => {
    const { html } = renderHeader();
    expect(html).toContain('data-account-menu="app"');
    expect(html).toContain('data-tone="studio"');
    expect(header).toContain("import AccountMenu from '@/components/account/account-menu'");
    // No second implementation was written for the builder.
    expect(code(header)).not.toContain('Menu.Root');
  });

  it('reads the cart badge from the ONE existing cart count', () => {
    expect(header).toContain("import { useCart } from '@/lib/cart/provider'");
    expect(renderHeader().html).toContain('data-cart-drawer="2"');
  });

  it('hands the guard to every control that can leave — including the brand mark', () => {
    const { html } = renderHeader();
    expect(html).toContain('data-guarded="true"'); // both overlays received it
    expect(html.match(/data-guarded="true"/g)?.length).toBe(2);
    // The brand link is an anchor whose left-click is intercepted.
    expect(header).toContain("onLeave('/dashboard')");
    expect(header).toMatch(/e\.preventDefault\(\);\s*\n\s*onLeave\('\/dashboard'\)/);
  });
});

// ── THE CART DRAWER ──────────────────────────────────────────────────────────────────────────

describe('the cart drawer shows the real cart and never leaves silently', () => {
  it('reads the cart page’s OWN query — one cart, one eligibility rule', () => {
    expect(drawer).toContain("import { getCartOverview } from '@/lib/actions/cart'");
    const action = src('src/lib/actions/cart.ts');
    expect(action).toContain('loadCartRows(supabase)');
    // …and the cart page now calls the same extracted read rather than its own copy.
    expect(src('src/app/(app)/cart/page.tsx')).toContain('await loadCartRows(supabase)');
    expect(code(src('src/app/(app)/cart/page.tsx'))).not.toContain('listCartItems');
  });

  it('reads on OPEN — no poll, no timer, no read for a drawer nobody opens', () => {
    expect(drawer).toContain('if (open) void load()');
    for (const bad of ['setInterval', 'setTimeout', 'useSWR', 'refetchInterval']) {
      expect(code(drawer)).not.toContain(bad);
    }
  });

  it('invents no price — money stays at checkout', () => {
    // No currency, no arithmetic, no total. The drawer is allowed to SAY where prices live
    // ("Prices are shown at checkout") — that sentence is the point, not a violation of it.
    for (const bad of ['₹', 'toFixed', 'reduce(', 'unitPrice', 'lineSubtotal', 'totalAmount', 'computeOrderAmount']) {
      expect(code(drawer)).not.toContain(bad);
    }
    expect(drawer).toContain('Prices are shown at checkout');
  });

  it('uses the EXISTING cart and checkout routes, and creates neither', () => {
    expect(drawer).toContain("leave('/cart')");
    expect(drawer).toContain("leave('/checkout/cart')");
    expect(code(drawer)).not.toContain('createOrder');
    expect(code(drawer)).not.toContain('createCombinedOrder');
  });

  it('handles an empty cart with the cart page’s own words and destination', () => {
    expect(drawer).toContain('Your cart is empty');
    expect(drawer).toContain("leave('/dashboard')");
    const page = src('src/app/(app)/cart/page.tsx');
    expect(page).toContain('Your cart is empty');
  });

  it('OPENING is not leaving — the guard is only on the two destinations', () => {
    // `leave()` is the single exit path in this component, and it is the only caller of onLeave.
    expect(drawer.match(/onLeave\(/g)?.length).toBe(1);
    expect(drawer).toContain('const leave = (href: string) => {');
    // Nothing about opening consults or mentions dirty state.
    expect(code(drawer)).not.toContain('dirty');
  });

  it('is a real dialog with a close control, Escape and focus return — via the existing primitive', () => {
    expect(drawer).toContain("from '@base-ui/react/dialog'");
    for (const part of ['Dialog.Root', 'Dialog.Trigger', 'Dialog.Portal', 'Dialog.Backdrop', 'Dialog.Popup', 'Dialog.Title', 'Dialog.Close']) {
      expect(drawer).toContain(part);
    }
    expect(drawer).toContain('aria-label="Close the cart"');
    // No hand-rolled overlay: those behaviours belong to the primitive.
    expect(code(drawer)).not.toContain('document.addEventListener');
  });

  it('arrives from the right, on the project’s own easings, and respects reduced motion', () => {
    const css = src('src/app/globals.css');
    expect(drawer).toContain('ms-drawer-popup');
    expect(css).toContain('.ms-drawer-popup[data-starting-style]');
    expect(css).toContain('translateX(102%)');
    expect(css).toContain('var(--ease-premium)');
    const reduced = Array.from(css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/g))
      .map((m) => m[0])
      .filter((b) => b.includes('ms-drawer'));
    expect(reduced.length).toBe(1);
    expect(reduced[0]).toContain('animation: none');
    expect(reduced[0]).not.toContain('display: none');
  });
});

// ── THE ACCOUNT MENU, IN THE BUILDER ─────────────────────────────────────────────────────────

describe('the account menu is the existing one, interposed on rather than copied', () => {
  it('offers the app-context destinations and the existing logout', () => {
    const model = src('src/components/account/account-menu-model.ts');
    expect(model).toContain("{ href: '/', label: 'Home'");
    expect(model).toContain("href: '/stories'");
    expect(model).toContain("href: '/contact'");
    expect(menu).toContain("import { signOut } from '@/lib/actions/auth'");
  });

  it('lets a host take over a destination, and defaults to not doing so', () => {
    expect(menu).toContain('onNavigate?: (href: string) => boolean');
    expect(menu).toContain('onSignOut?: () => boolean');
    expect(menu).toContain('if (onNavigate?.(link.href)) event.preventDefault();');
    expect(menu).toContain('if (onSignOut?.()) event.preventDefault();');
    // Optional: every other surface is unchanged.
    expect(src('src/components/public-header-nav.tsx')).not.toContain('onNavigate');
    expect(src('src/components/app-header.tsx')).not.toContain('onNavigate');
  });
});

// ── THE GUARD ────────────────────────────────────────────────────────────────────────────────

describe('one canonical guard, and one way out', () => {
  it('has a single dirty source and a single navigation primitive', () => {
    // The dirty flag is the builder api's, as it always was — nothing here invents a second.
    expect(builder).toContain('api.dirty');
    expect(builder).toContain('const performLeave = useCallback(');
    expect(builder).toContain('const requestLeave = useCallback(');
    // requestLeave is what every entry point calls; performLeave is the only thing that navigates.
    expect(builder).toContain("const leaveTo = useCallback((href: string) => requestLeave({ kind: 'route', href })");
    expect(builder).toContain("const leaveBySigningOut = useCallback(() => requestLeave({ kind: 'signout' })");
  });

  it('navigates immediately when clean, and asks when dirty', () => {
    const fn = /const requestLeave = useCallback\([\s\S]*?\n  \);/.exec(builder)?.[0] ?? '';
    expect(fn).toContain('if (!api.dirty) {');
    expect(fn).toContain('performLeave(nav);');
    expect(fn).toContain('setExitConfirmOpen(true);');
  });

  it('remembers the destination while the dialog is open', () => {
    expect(builder).toContain('const pendingNav = useRef<');
    expect(builder).toContain('pendingNav.current = nav;');
    expect(builder).toContain('performLeave(pendingNav.current);');
  });

  it('SAVES, then confirms success, then navigates — in that order and no other', () => {
    const fn = /const confirmSaveAndLeave = async \(\) => \{[\s\S]*?\n  \};/.exec(builder)?.[0] ?? '';
    expect(fn).not.toBe('');
    const save = fn.indexOf('await save()');
    const guard = fn.indexOf('if (!ok)');
    const nav = fn.indexOf('performLeave(pendingNav.current)');
    expect(save).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(save); // the result is checked after the save
    expect(nav).toBeGreaterThan(guard); // and navigation only after that check
  });

  it('a failed save keeps the customer, the dialog and the changes exactly where they are', () => {
    const fn = /const confirmSaveAndLeave = async \(\) => \{[\s\S]*?\n  \};/.exec(builder)?.[0] ?? '';
    // ONLY the failure branch — up to the comment that begins the success path.
    const fail = fn.slice(fn.indexOf('if (!ok)'), fn.indexOf('// SAVE'));
    expect(fail).toContain('return;');
    expect(fail).not.toContain('router.push');
    expect(fail).not.toContain('setExitConfirmOpen(false)');
    expect(fail).not.toContain('setDirty(false)');
  });

  it('continue-without-saving discards deliberately and does not save', () => {
    const fn = /const confirmLeaveWithout = \(\) => \{[\s\S]*?\n  \};/.exec(builder)?.[0] ?? '';
    expect(fn).toContain('api.setDirty(false)');
    expect(fn).toContain('performLeave(pendingNav.current)');
    expect(fn).not.toContain('await save');
  });

  it('cannot double-submit a save, and cannot navigate twice', () => {
    expect(builder).toContain('const exitingRef = useRef(false);');
    expect(builder).toContain('if (exitingRef.current) return;');
    expect(builder).toContain('const leaving = useRef(false);');
    expect(builder).toContain('if (leaving.current) return;');
  });

  it('keeps the existing browser-back and beforeunload guards intact', () => {
    expect(builder).toContain("window.addEventListener('beforeunload', handler)");
    expect(builder).toContain("window.addEventListener('popstate', onPop)");
    expect(builder).toContain('sentinelPushed');
    // The trapped Back still resolves to the dashboard, as it always did.
    expect(builder).toContain("pendingNav.current = { kind: 'route', href: '/dashboard' };");
  });

  it('signs out through the EXISTING action rather than a second logout', () => {
    expect(builder).toContain("import { signOut } from '@/lib/actions/auth'");
    expect(builder).toContain("if (nav.kind === 'signout') void signOut();");
  });
});

// ── THE AUDIT ────────────────────────────────────────────────────────────────────────────────

describe('every builder exit is guarded — the audit', () => {
  /** Files that make up the builder surface a customer or admin can click. */
  const FILES = [
    '_builder.tsx',
    '_header.tsx',
    '_toolbar.tsx',
    '_album-settings.tsx',
    '_canvas-bar.tsx',
    '_cover-bar.tsx',
    '_context-bar.tsx',
    '_selection-bar.tsx',
    '_tray-toolbar.tsx',
    '_properties-panel.tsx',
  ];

  it('no builder surface pushes a route except through the one primitive', () => {
    for (const f of FILES) {
      const s = code(src(`${B}${f}`));
      const pushes = Array.from(s.matchAll(/router\.(push|replace)\(([^)]*)\)/g)).map((m) => m[0]);
      for (const p of pushes) {
        // The only permitted push in the whole surface is the one inside performLeave.
        expect(p).toBe('router.push(nav.href)');
      }
    }
  });

  it('every off-builder link intercepts its own click', () => {
    // A <Link> that leaves must call onLeave/leaveTo, or it is a silent exit.
    const OFF_BUILDER = [
      [`${B}_header.tsx`, '/dashboard'],
      [`${B}_toolbar.tsx`, '/checkout/'],
      [`${B}_album-settings.tsx`, '/albums/new'],
      [`${B}_builder.tsx`, '/admin/albums/'],
    ] as const;
    for (const [file, href] of OFF_BUILDER) {
      const s = src(file);
      expect(s).toContain(href);
      // Each of those hrefs sits on an anchor whose click is intercepted.
      expect(s).toMatch(/onClick=\{\(e\) => \{\s*\n\s*e\.preventDefault\(\);/);
    }
  });

  it('the guard covers the paths this phase added AND the three it found unguarded', () => {
    // Added by this phase.
    expect(header).toContain('onLeave');
    expect(drawer).toContain('onLeave');
    // Pre-existing and previously silent: the toolbar's Checkout, Album Settings' New album,
    // and the admin "Back to admin" link.
    expect(src(`${B}_toolbar.tsx`)).toContain('onLeave(`/checkout/${albumId}`)');
    expect(src(`${B}_album-settings.tsx`)).toContain("onLeave('/albums/new')");
    expect(builder).toContain('leaveTo(`/admin/albums/${albumId}`)');
  });
});

// ── THE DIALOG ───────────────────────────────────────────────────────────────────────────────

describe('the unsaved-changes dialog', () => {
  const modals = src(`${B}_builder-modals.tsx`);

  it('is a custom dialog, never window.confirm', () => {
    expect(builder).not.toContain('window.confirm');
    expect(modals).not.toContain('window.confirm');
    expect(modals).toContain('export function ExitGuardDialog(');
  });

  it('offers both required choices plus a dismissal', () => {
    expect(modals).toContain('Save & leave');
    expect(modals).toContain('Leave without saving');
    expect(modals).toContain('Cancel');
  });

  it('carries dialog semantics, a title, a description and Escape', () => {
    expect(modals).toContain('role="dialog"');
    expect(modals).toContain('aria-modal="true"');
    expect(modals).toContain('aria-labelledby="ms-exit-guard-title"');
    expect(modals).toContain('aria-describedby="ms-exit-guard-desc"');
    expect(modals).toContain("if (e.key === 'Escape' && !exitingRef.current)");
    // Focus lands on the recommended action, not the destructive one.
    expect(modals).toContain('panelRef.current?.querySelector');
  });

  it('surfaces the save failure and says so while saving', () => {
    expect(modals).toContain('{error && <p');
    expect(modals).toContain("{exiting ? 'Saving…' : 'Save & leave'}");
    expect(modals).toContain('disabled={exiting}');
  });

  it('uses the existing motion utilities, not a new system', () => {
    expect(modals).toContain('animate-fade-in');
    expect(modals).toContain('animate-scale-in');
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['framer-motion']).toBeUndefined();
  });
});
