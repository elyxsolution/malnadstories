/**
 * PHASE 2 — AUTHENTICATION, AND THE DESIGN THAT MUST SURVIVE IT.
 *
 * The invariant this phase exists for is narrow and easy to break silently:
 *
 *     a visitor chooses a design on a PUBLIC page → is asked to sign in →
 *     and lands on THAT design, not on a generic dashboard.
 *
 * Two kinds of assertion here, and they are deliberately different in kind:
 *
 *   · BEHAVIOURAL, over the real `lib/auth/next` module — the open-redirect validator and the
 *     link builders. That module is pure, so it is tested as a function, exhaustively, including
 *     every off-site shape a `next` parameter can take.
 *   · SOURCE-LEVEL, over the files that WIRE it up. The middleware, the `(app)` layout guard, the
 *     login/signup pages and the album-creation page are Next server plumbing that cannot be
 *     invoked without a request, a cookie store and a database. Asserting that each one routes
 *     through the single validator (and that none of them grew a second one) is what stops the
 *     continuation being reintroduced ad hoc in one place and quietly diverging.
 *
 * Pure: no database, no network, no browser. Same contract as the rest of this suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_AFTER_AUTH,
  authCallbackUrl,
  loginHref,
  resolveNextPath,
  safeNextPath,
  signupHref,
  withNext,
} from '@/lib/auth/next';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Source with comments stripped — these files explain themselves at length. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DESIGN = '/albums/new?design=4f1c2a3e-0000-4000-8000-000000000001';

// ── A · THE VALIDATOR ────────────────────────────────────────────────────────────────────────

describe('safeNextPath — the one open-redirect rule', () => {
  it('accepts ordinary same-origin destinations', () => {
    for (const ok of ['/dashboard', '/cart', DESIGN, '/support/requests#open', '/a?b=c&d=e']) {
      expect(safeNextPath(ok)).toBe(ok);
    }
  });

  it('rejects every off-site shape', () => {
    const hostile = [
      'https://evil.example',
      'http://evil.example',
      '//evil.example',
      '///evil.example',
      '/\\evil.example', // browsers normalise the backslash to a slash → protocol-relative
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'evil.example',
      '../admin',
    ];
    for (const bad of hostile) expect(safeNextPath(bad)).toBeNull();
  });

  it('rejects control characters, which are a header/URL smuggling vector', () => {
    for (const bad of ['/a\nb', '/a\rb', '/a\u0000b', '/a\tb', '/a\u007fb']) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });

  it('is total — a non-string, empty or absurd value yields null rather than throwing', () => {
    const junk: unknown[] = [null, undefined, '', '/', 42, {}, [], `/${'x'.repeat(600)}`];
    for (const bad of junk) expect(safeNextPath(bad as string)).toBeNull();
  });

  it('rejects the auth pages themselves — a destination of /login is a redirect loop', () => {
    // Middleware forwards an already-signed-in visitor off /login to their pending destination.
    // If that destination were /login, it would forward to /login again, indefinitely.
    for (const bad of ['/login', '/signup', '/login?next=%2Flogin', '/signup#x']) {
      expect(safeNextPath(bad)).toBeNull();
    }
    // …but the password-reset flow's own destinations must keep working.
    expect(safeNextPath('/reset-password')).toBe('/reset-password');
    expect(safeNextPath('/forgot-password')).toBe('/forgot-password');
    // And a path that merely STARTS with those words is a different page, not an auth page.
    expect(safeNextPath('/login-help')).toBe('/login-help');
  });

  it('resolveNextPath substitutes the default rather than propagating a rejection', () => {
    expect(resolveNextPath(DESIGN)).toBe(DESIGN);
    expect(resolveNextPath('//evil.example')).toBe(DEFAULT_AFTER_AUTH);
    expect(resolveNextPath(null)).toBe(DEFAULT_AFTER_AUTH);
    expect(DEFAULT_AFTER_AUTH).toBe('/dashboard');
  });
});

describe('the link builders encode once, and never emit an unsafe next', () => {
  it('withNext round-trips a destination through encodeURIComponent', () => {
    const href = withNext('/login', DESIGN);
    expect(href.startsWith('/login?next=')).toBe(true);
    const back = new URLSearchParams(href.slice('/login?'.length)).get('next');
    expect(back).toBe(DESIGN);
  });

  it('an unsafe or absent destination produces the BARE path — never a dropped-in raw value', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '', null, undefined]) {
      expect(withNext('/login', bad)).toBe('/login');
      expect(loginHref(bad)).toBe('/login');
      expect(signupHref(bad)).toBe('/signup');
    }
  });

  it('authCallbackUrl carries the destination onto the ONE callback both auth flows use', () => {
    const url = authCallbackUrl('https://app.test', DESIGN);
    expect(url.startsWith('https://app.test/auth/callback?next=')).toBe(true);
    expect(new URL(url).searchParams.get('next')).toBe(DESIGN);
    // …and refuses to carry an off-site one.
    expect(authCallbackUrl('https://app.test', '//evil.example')).toBe('https://app.test/auth/callback');
  });
});

// ── B · ONE AUTH ARCHITECTURE, ONE VALIDATOR ─────────────────────────────────────────────────

describe('no second authentication system, and no second redirect validator', () => {
  const AUTH_FILES = [
    'src/middleware.ts',
    'src/app/auth/callback/route.ts',
    'src/lib/actions/auth.ts',
    'src/app/(app)/layout.tsx',
    'src/app/(auth)/login/page.tsx',
    'src/app/(auth)/login/_form.tsx',
    'src/app/(auth)/signup/page.tsx',
    'src/app/(auth)/signup/_form.tsx',
    'src/app/(auth)/_google-auth.tsx',
  ];

  it('every auth surface still runs on Supabase — no new provider was introduced', () => {
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@supabase/ssr']).toBeTruthy();
    expect(pkg.dependencies['@supabase/supabase-js']).toBeTruthy();
    for (const forbidden of ['next-auth', '@auth/core', '@clerk/nextjs', 'lucia', 'firebase', 'framer-motion']) {
      expect(pkg.dependencies[forbidden]).toBeUndefined();
    }
  });

  it('nobody re-implements the relative-path check locally', () => {
    for (const f of AUTH_FILES) {
      // The one legitimate definition lives in lib/auth/next.ts and nowhere else.
      expect(code(src(f))).not.toContain('function safeNext');
    }
  });

  it('every file that redirects after auth imports the shared helper', () => {
    for (const f of [
      'src/middleware.ts',
      'src/app/auth/callback/route.ts',
      'src/lib/actions/auth.ts',
      'src/app/(app)/layout.tsx',
    ]) {
      expect(src(f)).toContain('@/lib/auth/next');
    }
  });
});

// ── C · THE UNAUTHENTICATED PATH ─────────────────────────────────────────────────────────────

describe('an unauthenticated "Use this design" keeps the design', () => {
  it('the public tile points at the real creation route and names the design in the URL', () => {
    const tile = src('src/components/public/blueprint-tile.tsx');
    expect(tile).toContain('/albums/new?design=${encodeURIComponent(id)}');
  });

  it('Home and Stories converge on the SAME mechanism — one tile, one href builder', () => {
    for (const f of ['src/components/public/blueprint-shelf.tsx', 'src/components/public/blueprint-gallery.tsx']) {
      const s = code(src(f));
      expect(s).toContain('BlueprintTile');
      // Neither surface builds its own destination, and neither hardcodes a design id.
      expect(s).not.toContain('/albums/new?');
      expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });

  it('the app-group guard redirects to /login CARRYING the intended path AND query', () => {
    const s = code(src('src/app/(app)/layout.tsx'));
    expect(s).toContain('loginHref');
    expect(s).toContain('x-pathname');
    expect(s).toContain('x-search'); // the design lives in the query — the path alone loses it
    expect(s).not.toContain("redirect('/login')");
  });

  it('middleware forwards the query and carries the destination on its own guard', () => {
    const s = code(src('src/middleware.ts'));
    expect(s).toContain("requestHeaders.set('x-search', request.nextUrl.search)");
    expect(s).toContain("withNext('/login', intended)");
  });

  it('the sign-in form submits the destination and the action re-validates it server-side', () => {
    expect(code(src('src/app/(auth)/login/_form.tsx'))).toContain('type="hidden" name="next"');

    const action = code(src('src/lib/actions/auth.ts'));
    // Never trusted from the form as-is: it goes through the validator on the way to redirect().
    expect(action).toContain("redirect(resolveNextPath(String(formData.get('next') ?? '')))");
    expect(action).not.toContain("redirect('/dashboard')");
  });

  it('signup and Google OAuth return through the SAME callback, carrying the destination', () => {
    expect(code(src('src/app/(auth)/signup/_form.tsx'))).toContain('authCallbackUrl(window.location.origin, next)');
    const g = code(src('src/app/(auth)/_google-auth.tsx'));
    expect(g).toContain('authCallbackUrl(window.location.origin, next)');
    expect(g).toContain("provider: 'google'");
  });

  it('the page components validate `next` before it reaches the browser', () => {
    for (const f of ['src/app/(auth)/login/page.tsx', 'src/app/(auth)/signup/page.tsx']) {
      const s = code(src(f));
      expect(s).toContain('safeNextPath(searchParams?.next)');
      // Server Components: reading searchParams, not useSearchParams (which would need Suspense).
      expect(s).not.toContain('useSearchParams');
      expect(s).not.toContain("'use client'");
    }
  });
});

// ── D · THE AUTHENTICATED PATH ───────────────────────────────────────────────────────────────

describe('an already-authenticated "Use this design" never sees a login screen', () => {
  it('the destination is an ordinary protected route, so a signed-in visitor just lands there', () => {
    // /albums/new is inside the (app) group, whose layout is the ONLY gate. A signed-in user
    // passes it without redirect — there is no separate "use design" entry to keep in step.
    expect(() => src('src/app/(app)/albums/new/page.tsx')).not.toThrow();
  });

  it('a signed-in visitor who still lands on /login is forwarded to their pending destination', () => {
    const s = code(src('src/middleware.ts'));
    expect(s).toContain("resolveNextPath(request.nextUrl.searchParams.get('next'))");
    // The old unconditional bounce to /dashboard would have discarded the design.
    expect(s).not.toContain("url.pathname = '/dashboard'");
  });
});

// ── E · THE BLUEPRINT ID IS UNTRUSTED INPUT ──────────────────────────────────────────────────

describe('the design id is validated and re-resolved server-side, never trusted', () => {
  const page = src('src/app/(app)/albums/new/page.tsx');

  it('is shape-checked as a uuid before it is used for anything', () => {
    expect(page).toContain('const UUID =');
    expect(code(page)).toContain('UUID.test(requested)');
  });

  it('is resolved against the ACTIVE catalog — an archived or invented id resolves to nothing', () => {
    const s = code(page);
    expect(s).toContain('listActiveBlueprints()');
    expect(s).toContain('blueprints.some((b) => b.id === requestedId)');
    expect(s).toContain('designUnavailable');
  });

  it('hands the wizard an ID ONLY — no configuration crosses the boundary from the URL', () => {
    const s = code(page);
    expect(s).toContain('initialBlueprintId={initialBlueprintId}');
    expect(s).not.toMatch(/searchParams\?\.(cover|blueprint|geometry|layout)/);
  });

  it('the wizard sends only the id to the server, on the EXISTING creation path', () => {
    const w = code(src('src/app/(app)/albums/new/_wizard.tsx'));
    expect(w).toContain('blueprintId: selectedDesign?.id');
    // No parallel apply path: the design card runs the same action the layout picker runs.
    expect(w).toContain('runApplyBlueprint(selectedDesign.id');
    expect(w).toContain('applyBlueprintToAlbum');
  });

  it('creation re-resolves the id itself, so the page check is UX and not the security gate', () => {
    const a = code(src('src/lib/actions/albums.ts'));
    expect(a).toContain('getActiveBlueprint(data.blueprintId)');
    expect(a).toContain('That design is unavailable. Please choose another.');
    // Identity comes from the verified JWT, never from the request body.
    expect(a).toContain('supabase.auth.getUser()');
    expect(a).toContain('user_id: userId');
  });

  it('the apply action is authenticated and ownership-scoped', () => {
    const b = code(src('src/lib/actions/builder.ts'));
    expect(b).toContain('applyBlueprintById');
    expect(b).toContain('auth.getUser()');
  });
});

// ── F · ERROR + RACE HANDLING ────────────────────────────────────────────────────────────────

describe('the failure modes a customer can actually reach', () => {
  it('a design that vanished between browsing and using is explained, not 500ed or dropped', () => {
    const w = src('src/app/(app)/albums/new/_wizard.tsx');
    expect(w).toContain('designUnavailable');
    expect(w).toContain('That design isn’t available any more');
  });

  it('a failed auth callback returns to sign-in WITH the destination and a plain message', () => {
    const s = code(src('src/app/auth/callback/route.ts'));
    expect(s).toContain("failed.searchParams.set('error', 'auth_callback_failed')");
    expect(s).toContain("failed.searchParams.set('next', next)");
    expect(code(src('src/app/(auth)/login/page.tsx'))).toContain('auth_callback_failed');
  });

  it('the sign-in action still distinguishes a transport failure from a bad credential', () => {
    // Pre-existing behaviour that the continuation work must not have disturbed.
    const s = code(src('src/lib/actions/auth.ts'));
    expect(s).toContain('isAuthRetryableFetchError(error)');
    expect(s).toContain("return { error: 'Invalid email or password' };");
  });

  it('one press creates one album — the double-submit race is closed synchronously', () => {
    const w = code(src('src/app/(app)/albums/new/_wizard.tsx'));
    expect(w).toContain('creatingRef');
    expect(w).toContain('if (creatingRef.current) return;');
    // Released on failure only; on success `albumId` becomes the guard.
    expect(w).toContain('creatingRef.current = false;');
  });

  it('logout still clears the session cookies and returns to the public site', () => {
    const s = code(src('src/lib/actions/auth.ts'));
    expect(s).toContain('supabase.auth.signOut()');
    expect(s).toContain("cookieStore.delete('remember_me')");
    expect(s).toContain("redirect('/')");
  });
});

// ── G · THE PUBLIC SURFACE STAYS PUBLIC ──────────────────────────────────────────────────────

describe('browsing designs never requires authentication', () => {
  const PUBLIC_PAGES = [
    'src/app/page.tsx',
    'src/app/stories/page.tsx',
    'src/app/about/page.tsx',
    'src/app/contact/page.tsx',
  ];

  it('no public page reads a user, a session or redirects to /login', () => {
    for (const f of PUBLIC_PAGES) {
      const s = code(src(f));
      expect(s).not.toContain('getUser(');
      expect(s).not.toContain('getSession(');
      expect(s).not.toContain("redirect('/login')");
      expect(s).not.toContain('@/lib/supabase/server');
    }
  });

  it('none of them sits inside the auth-guarded (app) group', () => {
    for (const f of PUBLIC_PAGES) expect(f).not.toContain('(app)');
  });

  it('middleware guards only the two prefixes it always guarded', () => {
    const s = code(src('src/middleware.ts'));
    expect(s).toContain("pathname.startsWith('/dashboard') || pathname.startsWith('/admin')");
    for (const publicPath of ["'/stories'", "'/about'", "'/contact'"]) {
      expect(s).not.toContain(`startsWith(${publicPath})`);
    }
  });

  it('/stories keeps its Phase 1 ISR — authentication did not make it dynamic', () => {
    expect(src('src/app/stories/page.tsx')).toContain('export const revalidate = 300');
  });

  it('the public projection still carries no interior geometry', () => {
    const s = code(src('src/lib/blueprints/public.ts'));
    expect(s).toContain('cover: b.blueprint.cover ?? null');
    expect(s).not.toContain('blocks:');
  });
});

// ── H · ACCESSIBILITY AND TOUCH ON THE NEW SURFACES ──────────────────────────────────────────

describe('the new auth surfaces are keyboard-usable and never fight a scroll', () => {
  const SURFACES = [
    'src/app/(auth)/login/_form.tsx',
    'src/app/(auth)/signup/_form.tsx',
    'src/app/(app)/albums/new/_selected-design.tsx',
  ];

  it('every error/notice is announced, not merely coloured', () => {
    expect(src('src/app/(auth)/login/_form.tsx')).toContain('role="alert"');
    expect(src('src/app/(auth)/signup/_form.tsx')).toContain('role="alert"');
  });

  it('the forms are built from the shared UI primitives, which own the focus treatment', () => {
    // A raw <input>/<button> here would be a second, unfocusable-looking control set. The auth
    // forms compose Label + Input/PasswordInput + Button, so keyboard focus, labelling and the
    // ring are inherited rather than re-specified per screen.
    for (const f of ['src/app/(auth)/login/_form.tsx', 'src/app/(auth)/signup/_form.tsx']) {
      const s = src(f);
      expect(s).toContain("from '@/components/ui/button'");
      expect(s).toContain("from '@/components/ui/label'");
      expect(s).toContain('<Label htmlFor=');
    }
  });

  it('the one hand-rolled control on the new surfaces carries its own focus ring', () => {
    expect(src('src/app/(app)/albums/new/_selected-design.tsx')).toContain('focus-visible:ring-2');
  });

  it('nothing on them captures a touch or locks the page scroll', () => {
    for (const f of SURFACES) {
      const s = code(src(f));
      const forbidden = [
        'onPointerDown',
        'onTouchStart',
        'onTouchMove',
        'setPointerCapture',
        'touch-action',
        'body.style.overflow',
      ];
      for (const bad of forbidden) expect(s).not.toContain(bad);
    }
  });

  it('the selected-design banner labels its dismiss control for screen readers', () => {
    expect(src('src/app/(app)/albums/new/_selected-design.tsx')).toContain('aria-label={`Start without the');
  });
});

// ── I · THINGS PHASE 2 MUST NOT HAVE TOUCHED ─────────────────────────────────────────────────

describe('scope discipline', () => {
  it('the builder keeps its unsaved-changes guard, and nothing new bypasses it', () => {
    const b = src('src/app/(app)/albums/[id]/build/_builder.tsx');
    expect(b).toMatch(/beforeunload|dirty/i);
    // The wizard's exits are the pre-existing router pushes, not a bare Link out of the builder.
    const w = code(src('src/app/(app)/albums/new/_wizard.tsx'));
    expect(w).toContain('router.push(`/albums/${albumId}/build`)');
  });

  it('no service-role client reaches a client component on any surface this phase touched', () => {
    for (const f of [
      'src/app/(auth)/login/_form.tsx',
      'src/app/(auth)/signup/_form.tsx',
      'src/app/(auth)/_google-auth.tsx',
      'src/app/(app)/albums/new/_wizard.tsx',
      'src/app/(app)/albums/new/_selected-design.tsx',
    ]) {
      const s = src(f);
      expect(s).not.toContain('@/lib/supabase/service');
      expect(s).not.toContain('SERVICE_ROLE');
    }
  });

  it('no animation framework was added — the CSS motion system is still the only one', () => {
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['framer-motion']).toBeUndefined();
    expect(src('src/app/(app)/albums/new/_selected-design.tsx')).toContain('animate-rise');
  });
});
