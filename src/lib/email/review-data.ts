import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

/** Everything the album-review emails need, loaded via the service role (these run from
 *  actions that already authorized the caller). */
export type ReviewEmailData = {
  albumId: string;
  reviewId: string;
  title: string;
  email: string;
  customerName: string;
  status: string;
  requestedChanges: string | null; // latest active revision's instructions, if any
};

export async function loadReviewEmailData(albumId: string): Promise<ReviewEmailData | null> {
  const svc = createServiceClient();

  const { data: r } = await svc
    .from('album_reviews')
    .select('id, customer_id, status')
    .eq('album_id', albumId)
    .maybeSingle();
  const review = r as { id: string; customer_id: string; status: string } | null;
  if (!review) return null;

  const [albumRes, profileRes, userRes, revisionRes] = await Promise.all([
    svc.from('albums').select('title').eq('id', albumId).maybeSingle(),
    svc.from('profiles').select('name').eq('id', review.customer_id).maybeSingle(),
    svc.auth.admin.getUserById(review.customer_id),
    svc
      .from('revision_requests')
      .select('requested_changes, status')
      .eq('album_review_id', review.id)
      .in('status', ['open', 'in_progress', 'resubmitted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const album = albumRes.data as { title: string } | null;
  const profile = profileRes.data as { name: string | null } | null;
  const revision = revisionRes.data as { requested_changes: string } | null;

  return {
    albumId,
    reviewId: review.id,
    title: album?.title?.trim() || 'your album',
    email: userRes.data?.user?.email ?? '',
    customerName: profile?.name?.trim() || 'there',
    status: review.status,
    requestedChanges: revision?.requested_changes ?? null,
  };
}
