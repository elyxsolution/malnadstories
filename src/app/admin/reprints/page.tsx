import { requireAdmin } from '@/lib/auth/require-admin';
import ResolutionQueue from '../_resolutions/queue';

export default async function AdminReprintsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; since?: string; page?: string };
}) {
  await requireAdmin();
  return <ResolutionQueue kind="reprint" searchParams={searchParams} />;
}
