import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getAdminContext, NotAdminError, auditAccessDenied } from '@/lib/auth/require-admin';
import { routeCapability, roleHasCapability, navHrefsForRole } from '@/lib/auth/capabilities';
import AppHeader from '@/components/app-header';
import { brandFontVars } from '@/lib/fonts';
import AdminNav from './_nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Base admin gate (same as every admin action). Non-admins are bounced exactly as before.
  let ctx: Awaited<ReturnType<typeof getAdminContext>>;
  try {
    ctx = await getAdminContext();
  } catch (e) {
    redirect(e instanceof NotAdminError && e.message === 'Not signed in' ? '/login' : '/dashboard');
  }

  // RBAC route-guard — runs BEFORE any /admin page renders (this layout wraps them all,
  // including nested [id] routes). The capability for the current path is resolved server-
  // side; a role lacking it is audited + sent to a calm denied page. The authoritative
  // mutation gate still lives in each action (requireCapability) — this is the route layer.
  const pathname = headers().get('x-pathname');
  const cap = routeCapability(pathname);
  if (cap && !roleHasCapability(ctx.role, cap)) {
    await auditAccessDenied(ctx.userId, cap, pathname ?? undefined);
    redirect('/admin/denied');
  }

  // Server-computed nav allow-list (the nav never decides permissions client-side).
  const allowed = navHrefsForRole(ctx.role);

  return (
    // `data-admin` is a styling hook only (R7): it scopes the touch-target and narrow-viewport
    // rules in globals.css to the back office, so the customer surfaces cannot be affected.
    <div data-admin className={`${brandFontVars} font-ui flex min-h-screen flex-col`}>
      <AppHeader email={ctx.email ?? ''} />
      <div className="flex flex-1">
        <AdminNav allowed={allowed} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
