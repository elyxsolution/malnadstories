import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import Thread, { type ThreadMessage } from './_thread';

/**
 * Customer ticket detail. RLS scopes the ticket + its messages to the owner; a
 * non-owner (or guessed id) resolves to null → notFound(), so tickets can't be
 * enumerated. Internal admin notes are excluded both by RLS and the explicit filter.
 */
export default async function SupportTicketPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: ticketRow } = await supabase
    .from('support_tickets')
    .select('id, subject, description, category, priority, status, created_at, updated_at, album_id, order_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!ticketRow) notFound();
  const ticket = ticketRow as {
    id: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
    status: string;
    created_at: string;
    updated_at: string;
    album_id: string | null;
    order_id: string | null;
  };

  const { data: msgs } = await supabase
    .from('support_messages')
    .select('id, sender_type, body, created_at')
    .eq('ticket_id', ticket.id)
    .eq('is_internal', false)
    .order('created_at', { ascending: true });

  const messages = (msgs ?? []) as ThreadMessage[];

  return (
    <CustomerShell email={user?.email ?? ''}>
      <Thread
        ticket={{
          id: ticket.id,
          subject: ticket.subject,
          description: ticket.description,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          createdAt: ticket.created_at,
          albumId: ticket.album_id,
          orderId: ticket.order_id,
        }}
        messages={messages}
      />
    </CustomerShell>
  );
}
