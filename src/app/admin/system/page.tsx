import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { albumPdfs, payments, webhookEvents, auditLog } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { checkWorker, workerConfigured } from '@/lib/worker/health';
import { fmtDateTime, shortId } from '@/lib/admin/format';

/**
 * System health (read-only). Surfaces operational signals from existing data only:
 * the worker /health probe, album_pdfs status, payment + webhook counts, and the
 * recent audit trail. No secrets are rendered (the worker URL never leaves the server).
 */
export default async function AdminSystemPage() {
  await requireAdmin();

  const [worker, pdfRows, payRows, webhookRow, events] = await Promise.all([
    checkWorker(),
    db.select({ status: albumPdfs.status, c: count() }).from(albumPdfs).where(eq(albumPdfs.kind, 'preview')).groupBy(albumPdfs.status),
    db.select({ status: payments.status, c: count() }).from(payments).groupBy(payments.status),
    db.select({ c: count() }).from(webhookEvents),
    db
      .select({ action: auditLog.action, actorType: auditLog.actorType, entityType: auditLog.entityType, entityId: auditLog.entityId, createdAt: auditLog.createdAt })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(15),
  ]);

  const pdf = new Map(pdfRows.map((r) => [r.status, r.c]));
  const pay = new Map(payRows.map((r) => [r.status, r.c]));
  const captured = pay.get('captured') ?? 0;
  const failedPay = pay.get('failed') ?? 0;

  const workerStatus = !workerConfigured()
    ? { label: 'Not configured', tone: 'amber' as const }
    : worker.ready
      ? { label: 'Healthy', tone: 'green' as const }
      : { label: worker.reason === 'misconfigured' ? 'Misconfigured' : 'Unreachable', tone: 'red' as const };

  const tone = (t: 'green' | 'amber' | 'red') =>
    t === 'green' ? 'text-green-600' : t === 'amber' ? 'text-amber-600' : 'text-destructive';

  const cards = [
    { label: 'Image worker', value: workerStatus.label, detail: 'Hardening + PDF render service', tone: workerStatus.tone },
    {
      label: 'PDF generation',
      value: `${pdf.get('ready') ?? 0} ready`,
      detail: `${pdf.get('generating') ?? 0} generating · ${pdf.get('failed') ?? 0} failed`,
      tone: (pdf.get('failed') ?? 0) > 0 ? ('amber' as const) : ('green' as const),
    },
    {
      label: 'Payments',
      value: failedPay > 0 ? `${failedPay} failed` : 'OK',
      detail: `${captured} captured`,
      tone: failedPay > 0 ? ('amber' as const) : ('green' as const),
    },
    { label: 'Webhook events', value: String(webhookRow[0]?.c ?? 0), detail: 'Processed (deduped)', tone: 'green' as const },
  ];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-4 text-xl font-bold">System</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <span className={`h-2 w-2 rounded-full ${c.tone === 'green' ? 'bg-green-500' : c.tone === 'amber' ? 'bg-amber-500' : 'bg-destructive'}`} />
            </div>
            <p className={`mt-1 font-display text-xl font-semibold ${tone(c.tone)}`}>{c.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent events</h2>
      <div className="overflow-hidden rounded-lg border">
        <ul>
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-0">
              <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">{fmtDateTime(e.createdAt as unknown as string)}</span>
              <span className="w-16 shrink-0 text-xs font-medium uppercase text-muted-foreground">{e.actorType}</span>
              <span className="flex-1">
                {e.action}{' '}
                <span className="font-mono text-xs text-muted-foreground">
                  {e.entityType} #{shortId(e.entityId)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
