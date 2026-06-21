import 'server-only';
import { and, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { photos, albumPdfs, orders, emailLog, shipments, supportTickets } from '@/db/schema';
import {
  THRESHOLDS,
  type AlertSpec,
  type ServiceHealth,
  type ServiceName,
  type HealthStatus,
} from './model';

/**
 * Health collectors (Phase 10A). Each is a SINGLE cheap aggregate (count()/select 1) over an
 * existing status column — the same shape the admin dashboard already runs (src/app/admin/page.tsx).
 * No joins, no scans, no polling. Read-only: collectors never write to any existing table.
 * Every collector returns a per-service status + message + zero-or-more idempotent AlertSpecs.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const one = (rows: { c: number }[]) => rows[0]?.c ?? 0;

function build(
  service: ServiceName,
  status: HealthStatus,
  message: string,
  alerts: AlertSpec[],
): ServiceHealth {
  return { service, status, message, alerts };
}

async function collectDatabase(): Promise<ServiceHealth> {
  try {
    await db.execute(sql`select 1`);
    return build('database', 'healthy', 'Connection OK.', []);
  } catch {
    return build('database', 'critical', 'Database connection failed.', [
      { severity: 'critical', source: 'database', title: 'Database unreachable', message: 'A connection check failed.', dedupeKey: 'database:down' },
    ]);
  }
}

async function collectUploads(): Promise<ServiceHealth> {
  const t = THRESHOLDS.uploads;
  const stuck = one(
    await db.select({ c: count() }).from(photos).where(and(eq(photos.status, 'pending'), lt(photos.uploadedAt, minutesAgo(t.stuckMin)))),
  );
  if (stuck >= t.stuckCrit)
    return build('uploads', 'critical', `${stuck} uploads stuck > ${t.stuckMin}m — the worker may be down.`, [
      { severity: 'critical', source: 'uploads', title: `${stuck} uploads stuck`, message: `Pending > ${t.stuckMin} minutes — image-hardening worker likely down.`, dedupeKey: 'uploads:stuck' },
    ]);
  if (stuck >= t.stuckWarn)
    return build('uploads', 'warning', `${stuck} upload(s) pending > ${t.stuckMin}m.`, [
      { severity: 'warning', source: 'uploads', title: `${stuck} uploads stuck`, message: `Pending > ${t.stuckMin} minutes — check the worker.`, dedupeKey: 'uploads:stuck' },
    ]);
  return build('uploads', 'healthy', 'No stuck uploads.', []);
}

async function collectPhotoProcessing(): Promise<ServiceHealth> {
  const t = THRESHOLDS.photoProcessing;
  const [backlog, rejected] = await Promise.all([
    db.select({ c: count() }).from(photos).where(eq(photos.status, 'pending')).then(one),
    db
      .select({ c: count() })
      .from(photos)
      .where(and(eq(photos.status, 'rejected'), gte(photos.uploadedAt, minutesAgo(t.rejectedWindowMin))))
      .then(one),
  ]);
  const alerts: AlertSpec[] = [];
  let status: HealthStatus = 'healthy';
  if (backlog >= t.backlogCrit) {
    status = 'critical';
    alerts.push({ severity: 'critical', source: 'photo_processing', title: `${backlog} photos backlogged`, message: `Processing backlog over ${t.backlogCrit}.`, dedupeKey: 'photo_processing:backlog' });
  } else if (backlog >= t.backlogWarn) {
    status = 'warning';
    alerts.push({ severity: 'warning', source: 'photo_processing', title: `${backlog} photos backlogged`, message: `Processing backlog over ${t.backlogWarn}.`, dedupeKey: 'photo_processing:backlog' });
  }
  if (rejected >= t.rejectedWarn) {
    if (status === 'healthy') status = 'warning';
    alerts.push({ severity: 'warning', source: 'photo_processing', title: `${rejected} photos rejected recently`, message: 'Images failed hardening (spoofed/undecodable/too large).', dedupeKey: 'photo_processing:rejected' });
  }
  const msg = `${backlog} pending · ${rejected} rejected (24h).`;
  return build('photo_processing', status, status === 'healthy' ? `Healthy — ${msg}` : msg, alerts);
}

async function collectPdf(): Promise<ServiceHealth> {
  const t = THRESHOLDS.pdf;
  const [failed, stuck] = await Promise.all([
    db.select({ c: count() }).from(albumPdfs).where(eq(albumPdfs.status, 'failed')).then(one),
    db
      .select({ c: count() })
      .from(albumPdfs)
      .where(and(eq(albumPdfs.status, 'generating'), lt(albumPdfs.requestedAt, minutesAgo(t.stuckMin))))
      .then(one),
  ]);
  const alerts: AlertSpec[] = [];
  let status: HealthStatus = 'healthy';
  if (failed >= t.failedCrit) {
    status = 'critical';
    alerts.push({ severity: 'critical', source: 'pdf_generation', title: `${failed} PDF generations failed`, message: `Failed album PDFs over ${t.failedCrit}.`, dedupeKey: 'pdf_generation:failed' });
  } else if (failed >= t.failedWarn) {
    status = 'warning';
    alerts.push({ severity: 'warning', source: 'pdf_generation', title: `${failed} PDF generation(s) failed`, message: 'Album preview PDFs ended in a failed state.', dedupeKey: 'pdf_generation:failed' });
  }
  if (stuck >= t.stuckWarn) {
    if (status === 'healthy') status = 'warning';
    alerts.push({ severity: 'warning', source: 'pdf_generation', title: `${stuck} PDF(s) stuck generating`, message: `Generating > ${t.stuckMin}m — the worker sweep should recover these.`, dedupeKey: 'pdf_generation:stuck' });
  }
  return build('pdf_generation', status, status === 'healthy' ? 'No PDF failures.' : `${failed} failed · ${stuck} stuck.`, alerts);
}

async function collectPayments(): Promise<ServiceHealth> {
  const t = THRESHOLDS.payments;
  const [failed, pendingStuck] = await Promise.all([
    db
      .select({ c: count() })
      .from(orders)
      .where(and(eq(orders.status, 'failed'), gte(orders.placedAt, minutesAgo(THRESHOLDS.recentWindowMin))))
      .then(one),
    db
      .select({ c: count() })
      .from(orders)
      .where(and(eq(orders.status, 'pending'), lt(orders.placedAt, minutesAgo(t.pendingStuckMin))))
      .then(one),
  ]);
  const alerts: AlertSpec[] = [];
  let status: HealthStatus = 'healthy';
  if (failed >= t.failedCrit) {
    status = 'critical';
    alerts.push({ severity: 'critical', source: 'payments', title: `${failed} payments failed (1h)`, message: `Failed payments over ${t.failedCrit} in the last hour.`, dedupeKey: 'payments:failed' });
  } else if (failed >= t.failedWarn) {
    status = 'warning';
    alerts.push({ severity: 'warning', source: 'payments', title: `${failed} payment(s) failed (1h)`, message: 'Recent payment failures.', dedupeKey: 'payments:failed' });
  }
  if (pendingStuck >= t.pendingStuckWarn) {
    if (status === 'healthy') status = 'warning';
    alerts.push({ severity: 'warning', source: 'payments', title: `${pendingStuck} order(s) stuck pending`, message: `Pending > ${t.pendingStuckMin}m — a webhook may not have confirmed.`, dedupeKey: 'payments:pending_stuck' });
  }
  return build('payments', status, status === 'healthy' ? 'No recent payment issues.' : `${failed} failed · ${pendingStuck} stuck pending.`, alerts);
}

async function collectEmail(): Promise<ServiceHealth> {
  const t = THRESHOLDS.email;
  const failed = one(
    await db
      .select({ c: count() })
      .from(emailLog)
      .where(and(eq(emailLog.status, 'failed'), gte(emailLog.createdAt, minutesAgo(THRESHOLDS.recentWindowMin)))),
  );
  if (failed >= t.failedCrit)
    return build('email', 'critical', `${failed} email sends failed (1h).`, [
      { severity: 'critical', source: 'email', title: `${failed} email sends failed (1h)`, message: 'Many recent send failures — check the provider.', dedupeKey: 'email:failed' },
    ]);
  if (failed >= t.failedWarn)
    return build('email', 'warning', `${failed} email send(s) failed (1h).`, [
      { severity: 'warning', source: 'email', title: `${failed} email send(s) failed (1h)`, message: 'Recent transactional email failures.', dedupeKey: 'email:failed' },
    ]);
  return build('email', 'healthy', 'No recent email failures.', []);
}

async function collectShipping(): Promise<ServiceHealth> {
  const t = THRESHOLDS.shipping;
  const failed = one(await db.select({ c: count() }).from(shipments).where(eq(shipments.shipmentStatus, 'failed')));
  if (failed >= t.failedCrit)
    return build('shipping', 'critical', `${failed} shipments failed.`, [
      { severity: 'critical', source: 'shipping', title: `${failed} shipments failed`, message: `Failed shipments over ${t.failedCrit}.`, dedupeKey: 'shipping:failed' },
    ]);
  if (failed >= t.failedWarn)
    return build('shipping', 'warning', `${failed} shipment(s) failed.`, [
      { severity: 'warning', source: 'shipping', title: `${failed} shipment(s) failed`, message: 'Shipments in a failed state.', dedupeKey: 'shipping:failed' },
    ]);
  return build('shipping', 'healthy', 'No failed shipments.', []);
}

async function collectSupport(): Promise<ServiceHealth> {
  const t = THRESHOLDS.support;
  const backlog = one(
    await db.select({ c: count() }).from(supportTickets).where(inArray(supportTickets.status, ['open', 'in_progress'])),
  );
  if (backlog >= t.backlogCrit)
    return build('support', 'critical', `${backlog} unresolved tickets.`, [
      { severity: 'critical', source: 'support', title: `${backlog} unresolved tickets`, message: `Backlog over ${t.backlogCrit}.`, dedupeKey: 'support:backlog' },
    ]);
  if (backlog >= t.backlogWarn)
    return build('support', 'warning', `${backlog} unresolved tickets.`, [
      { severity: 'warning', source: 'support', title: `${backlog} unresolved tickets`, message: `Backlog over ${t.backlogWarn}.`, dedupeKey: 'support:backlog' },
    ]);
  return build('support', 'healthy', `${backlog} open tickets.`, []);
}

/** Run every collector (cheap, parallel). Returns one ServiceHealth per service, in order. */
export async function collectHealth(): Promise<ServiceHealth[]> {
  const results = await Promise.all([
    collectDatabase(),
    collectUploads(),
    collectPhotoProcessing(),
    collectPdf(),
    collectPayments(),
    collectEmail(),
    collectShipping(),
    collectSupport(),
  ]);
  return results;
}
