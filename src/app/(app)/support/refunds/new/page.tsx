import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import RequestForm, { type Option, type LinkRow } from '../../_request-form';
import { REFUND_REASONS, REFUND_REASON_LABEL, REFUND_ELIGIBLE_ORDER_STATUSES } from '@/lib/resolutions/model';

/** Request-a-refund page. Lists the customer's own paid-family orders (RLS-scoped). */
export default async function NewRefundPage({ searchParams }: { searchParams: { order?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [ordersRes, albumsRes, ticketsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, album_id, status, placed_at')
      .in('status', REFUND_ELIGIBLE_ORDER_STATUSES as unknown as string[])
      .order('placed_at', { ascending: false }),
    supabase.from('albums').select('id, title'),
    supabase.from('support_tickets').select('id, subject, status').order('updated_at', { ascending: false }),
  ]);

  const albumTitle = new Map(((albumsRes.data ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title]));
  const orders: LinkRow[] = ((ordersRes.data ?? []) as { id: string; album_id: string; status: string }[]).map((o) => ({
    id: o.id,
    label: `#${o.id.slice(0, 8)} · ${albumTitle.get(o.album_id) ?? 'album'} · ${o.status}`,
  }));
  const tickets: LinkRow[] = ((ticketsRes.data ?? []) as { id: string; subject: string }[]).map((t) => ({
    id: t.id,
    label: `#${t.id.slice(0, 8)} · ${t.subject}`,
  }));
  const options: Option[] = REFUND_REASONS.map((r) => ({ value: r, label: REFUND_REASON_LABEL[r] }));

  return (
    <CustomerShell email={user?.email ?? ''}>
      <RequestForm
        kind="refund"
        detailLabel="Reason"
        options={options}
        orders={orders}
        tickets={tickets}
        presetOrderId={searchParams.order ?? null}
      />
    </CustomerShell>
  );
}
