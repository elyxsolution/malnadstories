import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import RequestStatusView from '../../_status-view';
import { reprintIssueLabel } from '@/lib/resolutions/model';

/** Customer reprint-request status. RLS scopes to the owner; a guessed/foreign id → 404. */
export default async function ReprintDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('reprint_requests')
    .select('id, order_id, issue_type, description, status, created_at, resolved_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const r = data as {
    id: string;
    order_id: string;
    issue_type: string;
    description: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  };

  return (
    <CustomerShell email={user?.email ?? ''}>
      <RequestStatusView
        view={{
          kind: 'reprint',
          id: r.id,
          detailLabel: reprintIssueLabel(r.issue_type),
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
