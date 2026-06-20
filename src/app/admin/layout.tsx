import { redirect } from 'next/navigation';
import { requireAdmin, NotAdminError } from '@/lib/auth/require-admin';
import AppHeader from '@/components/app-header';
import { brandFontVars } from '@/lib/fonts';
import AdminNav from './_nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Backend authorization (same gate as every admin action). Non-admins are bounced.
  let admin: { email: string | null };
  try {
    admin = await requireAdmin();
  } catch (e) {
    redirect(e instanceof NotAdminError && e.message === 'Not signed in' ? '/login' : '/dashboard');
  }

  return (
    <div className={`${brandFontVars} font-ui flex min-h-screen flex-col`}>
      <AppHeader email={admin.email ?? ''} />
      <AdminNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
