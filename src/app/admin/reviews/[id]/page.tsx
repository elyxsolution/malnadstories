import { requireAdmin } from '@/lib/auth/require-admin';
import ReviewDetail from '../_detail';

export default async function AdminReviewDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();
  return <ReviewDetail id={params.id} />;
}
