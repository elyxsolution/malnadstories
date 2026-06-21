import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import Tickets, { type CustomerTicket } from './_tickets';

/**
 * Customer Support Center — the list of the signed-in user's own requests.
 * RLS (support_tickets_select, customer_id = auth.uid()) scopes every row to the owner;
 * there is no app-layer filter that could leak another customer's tickets.
 */
export default async function SupportPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, subject, category, priority, status, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const tickets = (data ?? []) as CustomerTicket[];

  return (
    <CustomerShell email={user?.email ?? ''}>
      <Tickets tickets={tickets} />
    </CustomerShell>
  );
}
