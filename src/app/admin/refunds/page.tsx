import { requireAdmin } from '@/lib/auth/require-admin';
import ResolutionQueue from '../_resolutions/queue';

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; since?: string; page?: string };
}) {
  await requireAdmin();
  return <ResolutionQueue kind="refund" searchParams={searchParams} />;
}
