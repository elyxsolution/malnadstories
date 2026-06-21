import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { refundReasonLabel, reprintIssueLabel } from '@/lib/resolutions/model';

export type ResolutionKind = 'refund' | 'reprint';

/** Everything the refund/reprint emails need, loaded via the service role (these run
 *  from server actions that already authorized the caller). */
export type ResolutionEmailData = {
  kind: ResolutionKind;
  requestId: string;
  orderId: string;
  email: string;
  customerName: string;
  kindLabel: string; // 'Refund' | 'Reprint'
  detailLabel: string; // reason / issue-type label
  status: string;
};

export async function loadResolutionEmailData(
  kind: ResolutionKind,
  requestId: string,
): Promise<ResolutionEmailData | null> {
  const svc = createServiceClient();
  const table = kind === 'refund' ? 'refund_requests' : 'reprint_requests';
  const detailCol = kind === 'refund' ? 'reason' : 'issue_type';

  const { data: r } = await svc
    .from(table)
    .select(`id, customer_id, order_id, status, ${detailCol}`)
    .eq('id', requestId)
    .maybeSingle();
  const req = r as
    | ({ id: string; customer_id: string; order_id: string; status: string } & Record<string, string>)
    | null;
  if (!req) return null;

  const [profileRes, userRes] = await Promise.all([
    svc.from('profiles').select('name').eq('id', req.customer_id).maybeSingle(),
    svc.auth.admin.getUserById(req.customer_id),
  ]);

  const profile = profileRes.data as { name: string | null } | null;
  const detail = req[detailCol] ?? 'other';

  return {
    kind,
    requestId: req.id,
    orderId: req.order_id,
    email: userRes.data?.user?.email ?? '',
    customerName: profile?.name?.trim() || 'there',
    kindLabel: kind === 'refund' ? 'Refund' : 'Reprint',
    detailLabel: kind === 'refund' ? refundReasonLabel(detail) : reprintIssueLabel(detail),
    status: req.status,
  };
}
