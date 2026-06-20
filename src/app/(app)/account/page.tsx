import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import AccountView, { type AccountAddress } from './_account';

/**
 * Account view (Design Completion Phase 1). Profile + addresses are real (existing
 * profiles/addresses tables, RLS-scoped); payment/notification/security are honest
 * read-only placeholders — no new entity or ownership model is introduced here.
 */
export default async function AccountPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('name, phone, created_at')
    .eq('id', user!.id)
    .maybeSingle();
  const profile = (profileRow ?? null) as { name: string | null; phone: string | null; created_at: string } | null;

  const { data: addressRows } = await supabase
    .from('addresses')
    .select('id, full_name, line1, city, state, pincode, is_default')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  const addresses = (addressRows ?? []) as AccountAddress[];

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : null;

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="mx-auto max-w-3xl px-5 py-9 sm:px-8">
        <div className="animate-rise">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Account</p>
          <h1 className="mt-3 font-display text-[2.6rem] font-normal leading-none tracking-tight text-primary">
            Your details.
          </h1>

          <AccountView
            email={user?.email ?? ''}
            name={profile?.name ?? ''}
            phone={profile?.phone ?? ''}
            memberSince={memberSince}
            addresses={addresses}
          />
        </div>
      </div>
    </CustomerShell>
  );
}
