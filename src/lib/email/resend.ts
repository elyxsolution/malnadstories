import 'server-only';
import { Resend } from 'resend';
import { emailConfig } from './config';

/**
 * The ONLY place the Resend SDK is referenced. Everything else talks to the
 * provider-agnostic `EmailProvider` interface, so swapping providers (or moving sends
 * to the worker queue) is a change to this one file.
 */
export type EmailMessage = { to: string; subject: string; html: string };
export type EmailProvider = { send(msg: EmailMessage): Promise<{ id: string }> };

let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(emailConfig.apiKey);
  return client;
}

export const provider: EmailProvider = {
  async send({ to, subject, html }) {
    const { data, error } = await resend().emails.send({
      from: emailConfig.from,
      to,
      subject,
      html,
    });
    if (error) throw new Error(error.message ?? 'Resend send failed');
    return { id: data?.id ?? '' };
  },
};
