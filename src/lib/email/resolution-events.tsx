import 'server-only';
import * as React from 'react';
import { sendTransactionalEmail } from './send-email';
import { emailConfig } from './config';
import { loadResolutionEmailData, type ResolutionKind } from './resolution-data';
import { SupportNotificationEmail } from './templates/support-notification';

/**
 * Refund/Reprint email events. Reuse the shared SupportNotificationEmail template and the
 * best-effort, never-throwing sendTransactionalEmail. Skipped when email is unconfigured,
 * so resolution actions never break on email. Not order emails → no orderId/idempotency
 * claim (one action fires each once).
 */

const ref = (id: string) => id.slice(0, 8);
const requestUrl = (kind: ResolutionKind, id: string) =>
  `${emailConfig.siteUrl}/support/${kind === 'refund' ? 'refunds' : 'reprints'}/${id}`;

// Per-status customer copy. 'pending' is the submission acknowledgement.
const STATUS_COPY: Record<string, { title: (k: string) => string; intro: (k: string) => string }> = {
  pending: {
    title: (k) => `We received your ${k.toLowerCase()} request`,
    intro: (k) =>
      `thanks for letting us know — your ${k.toLowerCase()} request has been logged and our team will review it shortly.`,
  },
  approved: {
    title: (k) => `Your ${k.toLowerCase()} request was approved`,
    intro: (k) => `good news — we've approved your ${k.toLowerCase()} request and are processing the next steps.`,
  },
  rejected: {
    title: (k) => `Update on your ${k.toLowerCase()} request`,
    intro: (k) =>
      `we've reviewed your ${k.toLowerCase()} request and won't be able to proceed this time. Reply to your support thread if you'd like to discuss it.`,
  },
  completed: {
    title: (k) => `Your ${k.toLowerCase()} request is complete`,
    intro: (k) => `your ${k.toLowerCase()} request has been completed. Thank you for your patience.`,
  },
};

/** Send the customer email for a given request status (pending|approved|rejected|completed). */
export async function sendResolutionStatusEmail(
  kind: ResolutionKind,
  requestId: string,
  status: string,
): Promise<void> {
  try {
    const copy = STATUS_COPY[status];
    if (!copy) return; // under_review and others are silent
    const data = await loadResolutionEmailData(kind, requestId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: `${kind}.${status}`,
      to: data.email,
      subject: `${copy.title(data.kindLabel)} — #${ref(requestId)}`,
      react: (
        <SupportNotificationEmail
          customerName={data.customerName}
          title={copy.title(data.kindLabel)}
          intro={copy.intro(data.kindLabel)}
          subject={`${data.kindLabel} · ${data.detailLabel} · Order #${ref(data.orderId)}`}
          ticketRef={ref(requestId)}
          ctaLabel="View your request"
          ticketUrl={requestUrl(kind, requestId)}
        />
      ),
    });
  } catch (e) {
    console.error(`[email] ${kind}.${status} error — continuing`, { requestId, error: String(e) });
  }
}

/** Notify the support inbox (ADMIN_EMAIL) that a new request was filed. */
export async function sendResolutionAdminNewEmail(kind: ResolutionKind, requestId: string): Promise<void> {
  try {
    if (!emailConfig.adminEmail) return;
    const data = await loadResolutionEmailData(kind, requestId);
    if (!data) return;
    await sendTransactionalEmail({
      event: `${kind}.admin_new`,
      to: emailConfig.adminEmail,
      subject: `New ${data.kindLabel.toLowerCase()} request — #${ref(requestId)} (${data.detailLabel})`,
      react: (
        <SupportNotificationEmail
          customerName="team"
          title={`New ${data.kindLabel.toLowerCase()} request`}
          intro={`a customer filed a ${data.kindLabel.toLowerCase()} request. Open the admin queue to review and decide.`}
          subject={`${data.detailLabel} · Order #${ref(data.orderId)}`}
          ticketRef={ref(requestId)}
          ctaLabel="Open in admin"
          ticketUrl={`${emailConfig.siteUrl}/admin/${kind === 'refund' ? 'refunds' : 'reprints'}/${requestId}`}
        />
      ),
    });
  } catch (e) {
    console.error(`[email] ${kind}.admin_new error — continuing`, { requestId, error: String(e) });
  }
}
