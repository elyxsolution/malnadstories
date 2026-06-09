import 'server-only';

/**
 * Email configuration — the ONLY source of sender/support/admin addresses + the site
 * URL. Everything is read from environment variables (CRITICAL requirement): no domain,
 * sender, or support address is ever hardcoded, so swapping the temporary Resend sender
 * for orders@malnadstories.com later is an env change only.
 */
export const emailConfig = {
  apiKey: process.env.RESEND_API_KEY ?? '',
  from: process.env.EMAIL_FROM ?? '',
  supportEmail: process.env.SUPPORT_EMAIL ?? '',
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
};

/** Email is only attempted when both the API key and a sender are configured. When it
 *  isn't, sends are skipped (logged, not errored) so checkout/fulfillment never break. */
export function isEmailEnabled(): boolean {
  return Boolean(emailConfig.apiKey && emailConfig.from);
}
