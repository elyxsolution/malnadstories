import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { boundedFetch, getUserWithDeadline } from '@/lib/supabase/timeout';
import { resolveNextPath, withNext } from '@/lib/auth/next';

// Absolute session age enforced when "Stay logged in" is OFF. A reliable backstop
// for browsers that restore session cookies on restart: even if the auth cookie
// survives, we force a re-login once the session is older than this.
const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

const CSP_REPORT_PATH = '/api/security/csp-report';

/**
 * Phase 10C — nonce-based CSP, Report-Only FIRST.
 *
 * Mirrors the ENFORCED host-based policy in next.config.mjs (kept unchanged so checkout
 * can't break) but replaces script `'unsafe-inline'` with a per-request `'nonce-<n>'`.
 * It is emitted as `Content-Security-Policy-Report-Only`, so it cannot block anything —
 * it only reports what an enforced nonce policy WOULD block, giving us the data to flip
 * enforcement on later. Setting the value as a REQUEST header makes Next attach the
 * nonce to its own inline scripts (so legit scripts don't report as violations); no
 * `strict-dynamic`; `style-src 'unsafe-inline'` retained (Tailwind/Next/Razorpay).
 */
function buildReportOnlyCsp(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "script-src 'self'",
    isDev ? "'unsafe-eval'" : '',
    `'nonce-${nonce}'`,
    'https://checkout.razorpay.com',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://*.r2.cloudflarestorage.com https://*.razorpay.com",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://*.razorpay.com https://lumberjack.razorpay.com",
    "frame-src 'self' https://api.razorpay.com https://*.razorpay.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://api.razorpay.com",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp-endpoint',
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  const sessionOnly = request.cookies.get('remember_me')?.value === '0';

  // Forward the matched path to Server Components (the admin layout reads it for the RBAC
  // route-guard). Presentation/authorization only — no auth/cookie behavior changes.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  // Phase 2: the QUERY too. `(app)/layout.tsx` rebuilds the intended destination from these two
  // so an unauthenticated "Use this design" round-trips back to /albums/new?design=<id> rather
  // than to a bare /dashboard. The path alone is not enough — the design lives in the query.
  requestHeaders.set('x-search', request.nextUrl.search);

  // Request correlation (Phase 10B): mint a request id (honor an upstream one) and forward it so
  // any server code in the request scope — server components/actions, route handlers, and the
  // libraries they call — can recover it via getRequestId(). Echoed on the response for devtools.
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  requestHeaders.set('x-request-id', requestId);

  // Phase 10C CSP nonce. btoa (not Buffer) — middleware runs on the edge runtime.
  // Setting the policy as a REQUEST header is what makes Next nonce its inline scripts;
  // the Report-Only RESPONSE header is added near the end. The enforced policy
  // (next.config.mjs) is untouched.
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== 'production';
  const cspReportOnly = buildReportOnlyCsp(nonce, isDev);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', cspReportOnly);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Supabase's own fetch carries no timeout, so a wedged Auth endpoint would hold this
      // invocation open until Vercel kills it at 25s. See lib/supabase/timeout.ts.
      global: { fetch: boundedFetch() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => {
            // Mirror server.ts: session-only cookies when the user opted out, so
            // refreshed tokens don't silently re-persist past browser close.
            const opts = sessionOnly
              ? { ...options, maxAge: undefined, expires: undefined }
              : options;
            supabaseResponse.cookies.set(name, value, opts);
          });
        },
      },
    },
  );

  // Use getUser() — not getSession() — to validate the JWT against Supabase.
  //
  // Bounded (lib/supabase/timeout.ts): with no `sb-*` cookie this returns in ~1ms without any
  // network call, but with one it makes a request Supabase may never answer. Unbounded, that
  // is a 25s MIDDLEWARE_INVOCATION_TIMEOUT on every signed-in request — the 2026-08-28
  // incident. On a timeout we fall through as "no user", which the guards below already
  // handle by failing CLOSED: protected paths still redirect to /login, and no path that is
  // protected today becomes reachable.
  const { user, timedOut } = await getUserWithDeadline(supabase);

  const { pathname } = request.nextUrl;

  if (timedOut) {
    // Deliberately visible in the platform logs: this is a provider-availability signal, not
    // something to swallow. One line per affected request, no token or cookie content.
    console.warn(
      `[middleware] supabase auth check exceeded its deadline for ${pathname} — treating request as unauthenticated`,
    );
  }

  // Absolute-age backstop: if the session is older than MAX_SESSION_MS while
  // "Stay logged in" is off, clear the auth + tracking cookies and force re-login.
  // This clears cookies locally; it does not revoke the refresh token at Supabase.
  if (user && sessionOnly) {
    const loginAt = Number(request.cookies.get('rm_login_at')?.value ?? 0);
    if (loginAt && Date.now() - loginAt > MAX_SESSION_MS) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      const res = NextResponse.redirect(url);
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith('sb-') || c.name === 'remember_me' || c.name === 'rm_login_at') {
          res.cookies.set(c.name, '', { maxAge: 0, path: '/' });
        }
      }
      return res;
    }
  }

  // Redirect unauthenticated users away from protected paths, CARRYING the destination
  // (Phase 2). Same validator as everywhere else, applied to a value we built ourselves —
  // belt and braces, since the path+query come from the request line.
  if (!user && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin'))) {
    const intended = `${pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(new URL(withNext('/login', intended), request.nextUrl.origin));
  }

  // Redirect authenticated users away from auth pages — to their pending destination when they
  // brought one, else the dashboard. Without this, a signed-in customer following a
  // /login?next=/albums/new?design=<id> link (a shared link, a stale tab, the back button) would
  // be dumped on the dashboard and lose the design.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const dest = resolveNextPath(request.nextUrl.searchParams.get('next'));
    return NextResponse.redirect(new URL(dest, request.nextUrl.origin));
  }

  // Echo the correlation id (the setAll callback above may have rebuilt the response).
  supabaseResponse.headers.set('x-request-id', requestId);

  // Phase 10C: Report-Only CSP + the reporting endpoint it points at. Report-Only never
  // blocks, so this is safe to ship alongside the enforced policy from next.config.
  supabaseResponse.headers.set('content-security-policy-report-only', cspReportOnly);
  supabaseResponse.headers.set('reporting-endpoints', `csp-endpoint="${CSP_REPORT_PATH}"`);
  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
