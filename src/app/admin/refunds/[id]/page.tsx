import { requireAdmin } from '@/lib/auth/require-admin';
import ResolutionDetail from '../../_resolutions/detail';

export default async function AdminRefundDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  return <ResolutionDetail kind="refund" id={params.id} />;
}
