import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import RequestStatusView from '../../_status-view';
import { refundReasonLabel } from '@/lib/resolutions/model';

/** Customer refund-request status. RLS scopes to the owner; a guessed/foreign id → 404. */
export default async function RefundDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('refund_requests')
    .select('id, order_id, reason, description, status, created_at, resolved_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as {
    id: string;
    order_id: string;
    reason: string;
    description: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  };

  return (
    <CustomerShell email={user?.email ?? ''}>
      <RequestStatusView
        view={{
          kind: 'refund',
          id: r.id,
          detailLabel: refundReasonLabel(r.reason),
          description: r.description,
          orderId: r.order_id,
          status: r.status,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
        }}
      />
    </CustomerShell>
  );
}
