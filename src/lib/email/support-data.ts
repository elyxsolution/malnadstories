import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { categoryLabel } from '@/lib/support/model';

/** Everything the support emails need, loaded once via the service role (these run
 *  from server actions that already authorized the caller). */
export type SupportEmailData = {
  ticketId: string;
  email: string;
  customerName: string;
  subject: string;
  categoryLabel: string;
  status: string;
};

export async function loadSupportEmailData(ticketId: string): Promise<SupportEmailData | null> {
  const svc = createServiceClient();

  const { data: t } = await svc
    .from('support_tickets')
    .select('id, customer_id, subject, category, status')
    .eq('id', ticketId)
    .maybeSingle();
  const ticket = t as
    | { id: string; customer_id: string; subject: string; category: string; status: string }
    | null;
  if (!ticket) return null;

  const [profileRes, userRes] = await Promise.all([
    svc.from('profiles').select('name').eq('id', ticket.customer_id).maybeSingle(),
    svc.auth.admin.getUserById(ticket.customer_id),
  ]);

  const profile = profileRes.data as { name: string | null } | null;
  return {
    ticketId: ticket.id,
    email: userRes.data?.user?.email ?? '',
    customerName: profile?.name?.trim() || 'there',
    subject: ticket.subject,
    categoryLabel: categoryLabel(ticket.category),
    status: ticket.status,
  };
}
