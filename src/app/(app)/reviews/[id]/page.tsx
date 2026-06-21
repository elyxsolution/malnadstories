import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Clock, XCircle, MessageSquareWarning, Eye } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import {
  reviewStatusLabel,
  reviewStatusChip,
  revisionStatusLabel,
  revisionStatusChip,
} from '@/lib/reviews/model';
import OpenBuilderButton from '../_open-builder';

type ReviewRow = {
  id: string;
  album_id: string;
  status: string;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};
type RevisionRow = {
  id: string;
  requested_changes: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Customer review detail. RLS scopes to the owner; a guessed/foreign id → 404. Read-only:
 *  the customer acts by editing + resubmitting in the builder, never by mutating the review. */
export default async function ReviewDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('album_reviews')
    .select('id, album_id, status, review_notes, created_at, updated_at, reviewed_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const review = data as ReviewRow;

  const [{ data: albumData }, { data: revisionData }] = await Promise.all([
    supabase.from('albums').select('title').eq('id', review.album_id).maybeSingle(),
    supabase
      .from('revision_requests')
      .select('id, requested_changes, status, created_at, completed_at')
      .eq('album_review_id', review.id)
      .order('created_at', { ascending: false }),
  ]);
  const title = (albumData as { title: string } | null)?.title ?? 'Your album';
  const revisions = (revisionData ?? []) as RevisionRow[];
  const activeRevision = revisions.find((r) => ['open', 'in_progress', 'resubmitted'].includes(r.status));

  const isApproved = review.status === 'approved';
  const isRejected = review.status === 'rejected';
  const isChanges = review.status === 'changes_requested';
  const isPending = review.status === 'pending_review';

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="px-5 py-9 sm:px-8 lg:py-12">
        <div className="mx-auto max-w-2xl">
          <Link
            href="/reviews"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Album reviews
          </Link>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${reviewStatusChip(review.status)}`}>
              {reviewStatusLabel(review.status)}
            </span>
            <span className="text-[12px] text-muted-foreground">#{review.id.slice(0, 8)}</span>
          </div>
          <h1 className="mt-2 font-display text-[2rem] font-normal leading-tight tracking-tight text-primary">{title}</h1>

          <Link
            href={`/albums/${review.album_id}/build`}
            className="mt-3 inline-flex items-center gap-1.5 border border-input bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-primary"
          >
            <Eye className="h-3.5 w-3.5 text-gold" /> View album
          </Link>

          {/* Headline state */}
          <div className="mt-8 border border-border bg-card p-5">
            {isPending && (
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-foreground">We’re reviewing your album</p>
                  <p className="text-[13px] text-muted-foreground">
                    Our team is checking it for print-readiness. We’ll email you the moment there’s an update.
                  </p>
                </div>
              </div>
            )}
            {isApproved && (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <div>
                  <p className="text-sm font-medium text-foreground">Approved &amp; ready to print</p>
                  <p className="text-[13px] text-muted-foreground">
                    Your album passed review. You can proceed to checkout from the album whenever you’re ready.
                  </p>
                </div>
              </div>
            )}
            {isRejected && (
              <div className="flex items-center gap-3">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-foreground">This album wasn’t approved</p>
                  <p className="text-[13px] text-muted-foreground">
                    See the reviewer’s note below, or reach out to support and we’ll help.
                  </p>
                </div>
              </div>
            )}
            {isChanges && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <MessageSquareWarning className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-foreground">A few changes are needed</p>
                    <p className="text-[13px] text-muted-foreground">
                      Make the edits below in the builder, then resubmit for review.
                    </p>
                  </div>
                </div>
                {activeRevision && (
                  <div className="border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-amber-700">Requested changes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {activeRevision.requested_changes}
                    </p>
                    <p className="mt-2 text-[12px] text-muted-foreground">Requested {fmt(activeRevision.created_at)}</p>
                  </div>
                )}
                <OpenBuilderButton albumId={review.album_id} />
              </div>
            )}
          </div>

          {/* Reviewer note (the latest customer-visible message) */}
          {review.review_notes && (
            <div className="mt-6">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Note from our team
              </h2>
              <p className="mt-2 whitespace-pre-wrap rounded-[2px] border border-border bg-muted/20 p-4 text-sm leading-relaxed">
                {review.review_notes}
              </p>
            </div>
          )}

          {/* Full revision history */}
          {revisions.length > 0 && (
            <div className="mt-6">
              <h2 className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">History</h2>
              <ul className="mt-3 space-y-3">
                {revisions.map((rev) => (
                  <li key={rev.id} className="border border-border bg-card p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${revisionStatusChip(rev.status)}`}>
                        {revisionStatusLabel(rev.status)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {fmt(rev.created_at)}
                        {rev.completed_at ? ` · Completed ${fmt(rev.completed_at)}` : ''}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{rev.requested_changes}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-6 text-[12px] text-muted-foreground">Submitted {fmt(review.created_at)}</p>
        </div>
      </div>
    </CustomerShell>
  );
}
