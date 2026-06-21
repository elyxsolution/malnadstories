import { requireAdmin } from '@/lib/auth/require-admin';
import ResolutionDetail from '../../_resolutions/detail';

export default async function AdminReprintDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  return <ResolutionDetail kind="reprint" id={params.id} />;
}
