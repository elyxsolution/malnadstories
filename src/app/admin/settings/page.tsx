import { requireAdmin } from '@/lib/auth/require-admin';
import { SHIPPING_TIERS } from '@/lib/shipping';
import { inr } from '@/lib/admin/format';

/**
 * Settings (read-only). Displays the current NON-SENSITIVE configuration — company
 * basics, the server-authoritative shipping tiers, and the payment setup. No secrets
 * (keys, URLs, webhook secrets) are read or rendered; nothing is editable (config is
 * env/source-of-truth driven — there is no settings store).
 */
export default async function AdminSettingsPage() {
  await requireAdmin();

  const cards: { title: string; fields: { label: string; value: string }[] }[] = [
    {
      title: 'Company',
      fields: [
        { label: 'Brand', value: 'Malnad Stories' },
        { label: 'Market', value: 'India' },
        { label: 'Currency', value: 'INR (₹)' },
      ],
    },
    {
      title: 'Shipping',
      fields: SHIPPING_TIERS.map((t) => ({ label: `${t.label} (${t.window})`, value: t.feeInr === 0 ? 'Free' : inr(t.feeInr) })),
    },
    {
      title: 'Payments',
      fields: [
        { label: 'Gateway', value: 'Razorpay' },
        { label: 'Currency', value: 'INR' },
        { label: 'Methods', value: 'UPI · Card · Net banking · Wallets' },
        { label: 'Confirmation', value: 'Webhook-driven (server-verified)' },
      ],
    },
    {
      title: 'Processing',
      fields: [
        { label: 'Image hardening', value: 'Background worker (sharp + file-type)' },
        { label: 'Preview PDF', value: 'Worker (Puppeteer) · auto on payment' },
        { label: 'Storage', value: 'Cloudflare R2 (private, presigned)' },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-xl font-bold">Settings</h1>
      <p className="mb-4 text-sm text-muted-foreground">Current configuration (read-only). No secrets are shown.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <div key={c.title} className="rounded-lg border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">{c.title}</h2>
            <dl className="space-y-2">
              {c.fields.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="text-right font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
