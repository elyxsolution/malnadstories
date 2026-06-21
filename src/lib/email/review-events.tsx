import 'server-only';
import * as React from 'react';
import { sendTransactionalEmail } from './send-email';
import { emailConfig } from './config';
import { loadReviewEmailData } from './review-data';
import { SupportNotificationEmail } from './templates/support-notification';

/**
 * Album-review email events. Reuse the shared SupportNotificationEmail template and the
 * best-effort, never-throwing sendTransactionalEmail (skipped when email is unconfigured,
 * so review actions never break on email). Not order emails → no orderId/idempotency claim.
 *
 * This is the REVIEW workflow only — these emails are about album approval, never about
 * payment, refunds, or fulfilment.
 */

const ref = (id: string) => id.slice(0, 8);
const reviewUrl = (reviewId: string) => `${emailConfig.siteUrl}/reviews/${reviewId}`;

// Per-status customer copy. in_progress / others are silent.
const STATUS_COPY: Record<
  string,
  { title: (t: string) => string; intro: (t: string, changes: string | null) => string }
> = {
  pending_review: {
    title: (t) => `We've received “${t}” for review`,
    intro: (t) =>
      `thanks for submitting “${t}”. Our team will review it for print-readiness and get back to you shortly. We'll email you the moment there's an update.`,
  },
  changes_requested: {
    title: (t) => `A few changes for “${t}”`,
    intro: (t, changes) =>
      `we've reviewed “${t}” and there are a couple of things to tidy up before it's print-ready:\n\n${changes ?? 'Open your review to see the details.'}\n\nOpen your review to see the notes, then jump into the builder, make the edits, and resubmit.`,
  },
  approved: {
    title: (t) => `“${t}” is approved`,
    intro: (t) =>
      `great news — “${t}” passed review and is ready to print. You can proceed to checkout whenever you're ready.`,
  },
  rejected: {
    title: (t) => `Update on “${t}”`,
    intro: (t) =>
      `we've reviewed “${t}” and can't take it forward in its current form. Open your review for the details, or reach out to support and we'll help.`,
  },
};

/** Customer email for a review status change (pending_review|changes_requested|approved|rejected). */
export async function sendReviewStatusEmail(albumId: string, status: string): Promise<void> {
  try {
    const copy = STATUS_COPY[status];
    if (!copy) return; // in_progress and others are silent
    const data = await loadReviewEmailData(albumId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: `review.${status}`,
      to: data.email,
      subject: `${copy.title(data.title)} — #${ref(data.reviewId)}`,
      react: (
        <SupportNotificationEmail
          customerName={data.customerName}
          title={copy.title(data.title)}
          intro={copy.intro(data.title, data.requestedChanges)}
          subject={`Album review · ${data.title}`}
          ticketRef={ref(data.reviewId)}
          ctaLabel="View your review"
          ticketUrl={reviewUrl(data.reviewId)}
        />
      ),
    });
  } catch (e) {
    console.error(`[email] review.${status} error — continuing`, { albumId, error: String(e) });
  }
}

/** Notify the admin inbox (ADMIN_EMAIL) that an album was submitted/resubmitted for review. */
export async function sendReviewAdminSubmittedEmail(albumId: string): Promise<void> {
  try {
    if (!emailConfig.adminEmail) return;
    const data = await loadReviewEmailData(albumId);
    if (!data) return;
    await sendTransactionalEmail({
      event: 'review.admin_submitted',
      to: emailConfig.adminEmail,
      subject: `Album submitted for review — “${data.title}” (#${ref(data.reviewId)})`,
      react: (
        <SupportNotificationEmail
          customerName="team"
          title="Album submitted for review"
          intro={`a customer submitted “${data.title}” for review. Open the review queue to check readiness and decide.`}
          subject={`Album review · ${data.title}`}
          ticketRef={ref(data.reviewId)}
          ctaLabel="Open in admin"
          ticketUrl={`${emailConfig.siteUrl}/admin/reviews/${data.reviewId}`}
        />
      ),
    });
  } catch (e) {
    console.error('[email] review.admin_submitted error — continuing', { albumId, error: String(e) });
  }
}
