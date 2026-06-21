import { requireAdmin } from '@/lib/auth/require-admin';
import ReviewQueue from './_queue';

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; since?: string; page?: string };
}) {
  await requireAdmin();
  return <ReviewQueue searchParams={searchParams} />;
}
