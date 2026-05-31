import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">Welcome, {user?.email}</p>
      <div className="mt-8 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <p className="text-lg font-medium">No albums yet</p>
        <p className="mt-1 text-sm">Your photo albums will appear here once you create them.</p>
      </div>
    </div>
  );
}
