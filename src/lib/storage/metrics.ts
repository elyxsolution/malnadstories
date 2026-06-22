import 'server-only';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { photos, albumPdfs, albums, orders, profiles, auditLog } from '@/db/schema';
import { adminUserEmails } from '@/lib/admin/users';
import {
  PDF_BYTES_PER_PAGE,
  RETENTION_DAYS,
  cleanupPriority,
  type Priority,
} from './model';

/**
 * Storage metrics — DB-DRIVEN aggregates only (Phase 11A+). No R2 bucket scan: every size
 * is an ESTIMATE computed from stored metadata (photo width/height, album page count).
 * Single bounded aggregate queries; the heavy overview is cached by the page via
 * unstable_cache. Reads cross-customer via Drizzle (the page is requireCapability-gated).
 */

// SQL estimate of a ready photo's bytes (master + thumb), mirroring model.estimatePhotoBytes.
const PHOTO_BYTES_SQL = sql<number>`coalesce(sum(case when ${photos.width} is not null and ${photos.height} is not null then (${photos.width}::double precision * ${photos.height}::double precision * 0.3 + 30000) else 2500000 end), 0)::double precision`;

// Delivered + RETENTION_DAYS old (delivered_at, else placed_at).
const deliveredCutoff = and(
  eq(orders.status, 'delivered'),
  sql`coalesce(${orders.deliveredAt}, ${orders.placedAt}) < now() - make_interval(days => ${RETENTION_DAYS})`,
);

export type StorageOverview = {
  photoCount: number;
  photoBytes: number;
  pdfCount: number;
  pdfBytes: number;
  totalBytes: number;
  eligibleAlbums: number;
  reclaimableBytes: number;
  efficiency: number; // reclaimable / total (0..1)
};

export async function getStorageOverview(): Promise<StorageOverview> {
  const eligibleSub = db.select({ albumId: orders.albumId }).from(orders).where(deliveredCutoff);

  const [[photoAgg], [pdfAgg], [elPhoto], [elPdf]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int`, bytes: PHOTO_BYTES_SQL })
      .from(photos)
      .where(and(eq(photos.status, 'ready'), isNotNull(photos.sanitizedKey))),
    db
      .select({ count: sql<number>`count(*)::int`, pages: sql<number>`coalesce(sum(${albums.size}), 0)::double precision` })
      .from(albumPdfs)
      .innerJoin(albums, eq(albumPdfs.albumId, albums.id))
      .where(and(eq(albumPdfs.status, 'ready'), isNotNull(albumPdfs.r2Key))),
    db
      .select({ count: sql<number>`count(*)::int`, bytes: PHOTO_BYTES_SQL })
      .from(photos)
      .where(and(eq(photos.status, 'ready'), isNotNull(photos.sanitizedKey), inArray(photos.albumId, eligibleSub))),
    db
      .select({ count: sql<number>`count(*)::int`, pages: sql<number>`coalesce(sum(${albums.size}), 0)::double precision` })
      .from(albumPdfs)
      .innerJoin(albums, eq(albumPdfs.albumId, albums.id))
      .where(and(eq(albumPdfs.status, 'ready'), isNotNull(albumPdfs.r2Key), inArray(albumPdfs.albumId, eligibleSub))),
  ]);

  const photoBytes = Number(photoAgg?.bytes ?? 0);
  const pdfBytes = Number(pdfAgg?.pages ?? 0) * PDF_BYTES_PER_PAGE;
  const totalBytes = photoBytes + pdfBytes;
  const reclaimableBytes = Number(elPhoto?.bytes ?? 0) + Number(elPdf?.pages ?? 0) * PDF_BYTES_PER_PAGE;

  // eligible distinct albums = delivered+old orders' albums that actually still hold assets.
  const eligibleAlbums = await db
    .select({ albumId: orders.albumId })
    .from(orders)
    .where(deliveredCutoff)
    .groupBy(orders.albumId);

  return {
    photoCount: photoAgg?.count ?? 0,
    photoBytes,
    pdfCount: pdfAgg?.count ?? 0,
    pdfBytes,
    totalBytes,
    eligibleAlbums: eligibleAlbums.length,
    reclaimableBytes,
    efficiency: totalBytes > 0 ? reclaimableBytes / totalBytes : 0,
  };
}

export type LargestAlbum = {
  albumId: string;
  title: string | null;
  customer: string;
  photoCount: number;
  hasPdf: boolean;
  bytes: number;
};

export async function getLargestAlbums(limit = 10): Promise<LargestAlbum[]> {
  const grouped = await db
    .select({ albumId: photos.albumId, count: sql<number>`count(*)::int`, bytes: PHOTO_BYTES_SQL })
    .from(photos)
    .where(and(eq(photos.status, 'ready'), isNotNull(photos.sanitizedKey), isNotNull(photos.albumId)))
    .groupBy(photos.albumId)
    .orderBy(desc(PHOTO_BYTES_SQL))
    .limit(limit);

  const ids = grouped.map((g) => g.albumId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];

  const [meta, pdfs] = await Promise.all([
    db
      .select({ id: albums.id, title: albums.title, userId: albums.userId, customerName: profiles.name, size: albums.size })
      .from(albums)
      .leftJoin(profiles, eq(albums.userId, profiles.id))
      .where(inArray(albums.id, ids)),
    db.select({ albumId: albumPdfs.albumId }).from(albumPdfs).where(and(inArray(albumPdfs.albumId, ids), eq(albumPdfs.status, 'ready'), isNotNull(albumPdfs.r2Key))),
  ]);
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const pdfSet = new Set(pdfs.map((p) => p.albumId));
  const emails = await adminUserEmails(meta.map((m) => m.userId));

  return grouped
    .map((g) => {
      const m = g.albumId ? metaById.get(g.albumId) : undefined;
      const hasPdf = g.albumId ? pdfSet.has(g.albumId) : false;
      const bytes = Number(g.bytes) + (hasPdf ? (m?.size ?? 36) * PDF_BYTES_PER_PAGE : 0);
      return {
        albumId: g.albumId as string,
        title: m?.title ?? null,
        customer: m?.customerName ?? (m ? emails.get(m.userId) ?? '—' : '—'),
        photoCount: g.count,
        hasPdf,
        bytes,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);
}

export type RetentionRow = {
  orderId: string;
  albumId: string;
  title: string | null;
  customer: string;
  deliveredAt: string;
  daysSince: number;
  photoCount: number;
  hasPdf: boolean;
  bytes: number;
  priority: Priority;
};

export async function getRetentionQueue(limit = 50): Promise<RetentionRow[]> {
  const eligible = await db
    .select({
      orderId: orders.id,
      albumId: orders.albumId,
      title: albums.title,
      userId: orders.userId,
      customerName: profiles.name,
      deliveredAt: sql<string>`coalesce(${orders.deliveredAt}, ${orders.placedAt})`,
    })
    .from(orders)
    .leftJoin(albums, eq(orders.albumId, albums.id))
    .leftJoin(profiles, eq(orders.userId, profiles.id))
    .where(deliveredCutoff)
    .orderBy(sql`coalesce(${orders.deliveredAt}, ${orders.placedAt}) asc`)
    .limit(limit);

  const ids = eligible.map((e) => e.albumId);
  if (ids.length === 0) return [];

  const [grouped, pdfs, emails] = await Promise.all([
    db
      .select({ albumId: photos.albumId, count: sql<number>`count(*)::int`, bytes: PHOTO_BYTES_SQL })
      .from(photos)
      .where(and(eq(photos.status, 'ready'), isNotNull(photos.sanitizedKey), inArray(photos.albumId, ids)))
      .groupBy(photos.albumId),
    db
      .select({ albumId: albumPdfs.albumId, size: albums.size })
      .from(albumPdfs)
      .innerJoin(albums, eq(albumPdfs.albumId, albums.id))
      .where(and(inArray(albumPdfs.albumId, ids), eq(albumPdfs.status, 'ready'), isNotNull(albumPdfs.r2Key))),
    adminUserEmails(eligible.map((e) => e.userId)),
  ]);
  const photoBy = new Map(grouped.map((g) => [g.albumId, g]));
  const pdfBy = new Map(pdfs.map((p) => [p.albumId, p.size]));

  return eligible
    .map((e) => {
      const g = photoBy.get(e.albumId);
      const pdfPages = pdfBy.get(e.albumId);
      const bytes = Number(g?.bytes ?? 0) + (pdfPages ? pdfPages * PDF_BYTES_PER_PAGE : 0);
      const daysSince = Math.floor((Date.now() - new Date(e.deliveredAt).getTime()) / 86_400_000);
      return {
        orderId: e.orderId,
        albumId: e.albumId,
        title: e.title,
        customer: e.customerName ?? emails.get(e.userId) ?? '—',
        deliveredAt: e.deliveredAt,
        daysSince,
        photoCount: g?.count ?? 0,
        hasPdf: pdfBy.has(e.albumId),
        bytes,
        priority: cleanupPriority(daysSince, bytes),
      };
    })
    .filter((r) => r.photoCount > 0 || r.hasPdf) // nothing to reclaim if already purged
    .sort((a, b) => b.bytes - a.bytes);
}

export type CleanupEvent = {
  id: string;
  actor: string;
  action: string;
  albumId: string | null;
  reclaimed: number;
  createdAt: string;
};

export async function getCleanupHistory(limit = 30): Promise<CleanupEvent[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorId: auditLog.actorId,
      actorName: profiles.name,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(profiles, eq(auditLog.actorId, profiles.id))
    .where(sql`${auditLog.action} like 'storage.%'`)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      actor: r.actorName ?? 'admin',
      action: r.action,
      albumId: (meta.album_id as string | undefined) ?? null,
      reclaimed: Number(meta.reclaimed_estimate ?? 0),
      createdAt: r.createdAt as unknown as string,
    };
  });
}
