import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AppHeaderGate from '@/components/app-header-gate';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hidden on the builder route, which renders its own unified full-bleed header. */}
      <AppHeaderGate email={user.email!} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
