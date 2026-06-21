import 'server-only';
import * as React from 'react';
import { sendTransactionalEmail } from './send-email';
import { emailConfig } from './config';
import { loadSupportEmailData } from './support-data';
import { SupportNotificationEmail } from './templates/support-notification';

/**
 * Typed support email events — the surface the support server actions call. Each loads
 * the ticket's data and renders the shared template; all sending/logging lives in
 * sendTransactionalEmail. These never throw (best-effort) and are skipped when email
 * is unconfigured, so support actions never break on email.
 *
 * Support emails are not order emails, so they carry no orderId — they are logged in
 * email_log without the per-order idempotency claim (a single action fires each once).
 */

const ticketUrl = (id: string) => `${emailConfig.siteUrl}/support/${id}`;
const ref = (id: string) => id.slice(0, 8);

/** New ticket → acknowledge to the customer. */
export async function sendSupportTicketCreatedEmail(ticketId: string): Promise<void> {
  try {
    const data = await loadSupportEmailData(ticketId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: 'support.created',
      to: data.email,
      subject: `We received your request — #${ref(ticketId)}`,
      react: (
        <SupportNotificationEmail
          customerName={data.customerName}
          title="We received your request"
          intro="thanks for reaching out — our team has your message and will reply soon. You can follow the conversation any time from your support page."
          subject={data.subject}
          ticketRef={ref(ticketId)}
          ctaLabel="View your request"
          ticketUrl={ticketUrl(ticketId)}
        />
      ),
    });
  } catch (e) {
    console.error('[email] support.created error — continuing', { ticketId, error: String(e) });
  }
}

/** Admin posted a public reply → notify the customer. */
export async function sendSupportReplyEmail(ticketId: string): Promise<void> {
  try {
    const data = await loadSupportEmailData(ticketId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: 'support.replied',
      to: data.email,
      subject: `New reply to your request — #${ref(ticketId)}`,
      react: (
        <SupportNotificationEmail
          customerName={data.customerName}
          title="You have a new reply"
          intro="our team has replied to your support request. Open it to read the response and continue the conversation."
          subject={data.subject}
          ticketRef={ref(ticketId)}
          ctaLabel="Read the reply"
          ticketUrl={ticketUrl(ticketId)}
        />
      ),
    });
  } catch (e) {
    console.error('[email] support.replied error — continuing', { ticketId, error: String(e) });
  }
}

/** Ticket resolved → let the customer know. */
export async function sendSupportResolvedEmail(ticketId: string): Promise<void> {
  try {
    const data = await loadSupportEmailData(ticketId);
    if (!data || !data.email) return;
    await sendTransactionalEmail({
      event: 'support.resolved',
      to: data.email,
      subject: `Your request was resolved — #${ref(ticketId)}`,
      react: (
        <SupportNotificationEmail
          customerName={data.customerName}
          title="Your request was resolved"
          intro="we've marked your support request as resolved. If anything still needs attention, just reply and it will reopen automatically."
          subject={data.subject}
          ticketRef={ref(ticketId)}
          ctaLabel="View your request"
          ticketUrl={ticketUrl(ticketId)}
        />
      ),
    });
  } catch (e) {
    console.error('[email] support.resolved error — continuing', { ticketId, error: String(e) });
  }
}

/** New ticket → notify the support inbox (ADMIN_EMAIL) if configured. */
export async function sendSupportAdminNewTicketEmail(ticketId: string): Promise<void> {
  try {
    if (!emailConfig.adminEmail) return;
    const data = await loadSupportEmailData(ticketId);
    if (!data) return;
    await sendTransactionalEmail({
      event: 'support.admin_new',
      to: emailConfig.adminEmail,
      subject: `New support request — #${ref(ticketId)} (${data.categoryLabel})`,
      react: (
        <SupportNotificationEmail
          customerName="team"
          title="New support request"
          intro={`a customer opened a ${data.categoryLabel.toLowerCase()} request. Open the admin console to triage and respond.`}
          subject={data.subject}
          ticketRef={ref(ticketId)}
          ctaLabel="Open in admin"
          ticketUrl={`${emailConfig.siteUrl}/admin/support/${ticketId}`}
        />
      ),
    });
  } catch (e) {
    console.error('[email] support.admin_new error — continuing', { ticketId, error: String(e) });
  }
}
