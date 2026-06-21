import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { requireAdmin } from '@/lib/auth/require-admin';

/**
 * Shown when a signed-in admin reaches an area their role doesn't include (the layout
 * route-guard redirects here). Still requires being an admin — the denial is a role scope,
 * not an auth failure. The block itself was already audited (access.denied) at the guard.
 */
export default async function AdminDeniedPage() {
  await requireAdmin();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/10 text-amber-600">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-xl font-bold">You don’t have access to this area</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your admin role doesn’t include this section. If you think you need access, ask a super admin to
        update your role.
      </p>
      <Link
        href="/admin"
        className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
