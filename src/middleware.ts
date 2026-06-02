import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Absolute session age enforced when "Stay logged in" is OFF. A reliable backstop
// for browsers that restore session cookies on restart: even if the auth cookie
// survives, we force a re-login once the session is older than this.
const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours

export async function middleware(request: NextRequest) {
  const sessionOnly = request.cookies.get('remember_me')?.value === '0';
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
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

  // Use getUser() — not getSession() — to validate the JWT against Supabase
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

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

  // Redirect unauthenticated users away from protected paths
  if (!user && (pathname.startsWith('/dashboard') || pathname.startsWith('/admin'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
