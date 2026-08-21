import Link from 'next/link';
import { desc, eq, sum } from 'drizzle-orm';
import { db } from '@/db';
import { coupons, couponRedemptions, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { inr, fmtDate } from '@/lib/admin/format';
import CreateCoupon from './_create-coupon';
import CouponToggle from './_coupon-actions';

type CouponLifecycle = 'Disabled' | 'Scheduled' | 'Expired' | 'Exhausted' | 'Active';

function lifecycle(c: {
  active: boolean;
  startsAt: Date | string;
  expiresAt: Date | string | null;
  maxUses: number | null;
  currentUses: number;
}): CouponLifecycle {
  const now = Date.now();
  if (!c.active) return 'Disabled';
  if (new Date(c.startsAt).getTime() > now) return 'Scheduled';
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now) return 'Expired';
  if (c.maxUses != null && c.currentUses >= c.maxUses) return 'Exhausted';
  return 'Active';
}

const LIFECYCLE_CHIP: Record<CouponLifecycle, string> = {
  Active: 'bg-green-500/10 text-green-600',
  Scheduled: 'bg-blue-500/10 text-blue-600',
  Disabled: 'bg-muted text-muted-foreground',
  Expired: 'bg-muted text-muted-foreground',
  Exhausted: 'bg-amber-500/10 text-amber-600',
};

export default async function AdminCouponsPage() {
  await requireAdmin();

  const rows = await db
    .select({
      id: coupons.id,
      code: coupons.code,
      active: coupons.active,
      discountType: coupons.discountType,
      discountValue: coupons.discountValue,
      currentUses: coupons.currentUses,
      maxUses: coupons.maxUses,
      startsAt: coupons.startsAt,
      expiresAt: coupons.expiresAt,
      createdReason: coupons.createdReason,
      createdBy: coupons.createdBy,
      createdByName: profiles.name,
      createdAt: coupons.createdAt,
    })
    .from(coupons)
    .leftJoin(profiles, eq(coupons.createdBy, profiles.id))
    .orderBy(desc(coupons.createdAt))
    .limit(200);

  const emails = await adminUserEmails(rows.map((r) => r.createdBy).filter(Boolean) as string[]);

  // Revenue impact: total discount actually redeemed per coupon (consumed on payment).
  const impactRows = await db
    .select({ couponId: couponRedemptions.couponId, total: sum(couponRedemptions.amountDiscounted) })
    .from(couponRedemptions)
    .groupBy(couponRedemptions.couponId);
  const impact = new Map(impactRows.map((r) => [r.couponId, Number(r.total ?? 0)]));

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Coupons</h1>
        <CreateCoupon />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No coupons yet. Create one to get started.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-center">Uses</th>
                <th className="px-3 py-2 text-right">Revenue impact</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Created by</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lc = lifecycle(r);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td data-label="Code" className="px-3 py-2">
                      <Link href={`/admin/coupons/${r.id}`} className="font-mono text-primary hover:underline">
                        {r.code}
                      </Link>
                    </td>
                    <td data-label="Status" className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LIFECYCLE_CHIP[lc]}`}>
                        {lc}
                      </span>
                    </td>
                    <td data-label="Type" className="px-3 py-2 capitalize">{r.discountType}</td>
                    <td data-label="Value" className="px-3 py-2 text-right">
                      {r.discountType === 'flat' ? inr(r.discountValue) : `${Number(r.discountValue)}%`}
                    </td>
                    <td data-label="Uses" className="px-3 py-2 text-center">
                      {r.currentUses}
                      {r.maxUses != null ? ` / ${r.maxUses}` : ''}
                    </td>
                    <td data-label="Revenue impact" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {(impact.get(r.id) ?? 0) > 0 ? `− ${inr(impact.get(r.id) ?? 0)}` : '—'}
                    </td>
                    <td data-label="Expires" className="px-3 py-2 text-muted-foreground">{fmtDate(r.expiresAt as unknown as string)}</td>
                    <td data-label="Created by" className="px-3 py-2 text-xs">
                      {r.createdByName ?? (r.createdBy && emails.get(r.createdBy)) ?? '—'}
                    </td>
                    <td data-label="Reason" className="px-3 py-2 max-w-[16rem] truncate text-xs text-muted-foreground" title={r.createdReason ?? ''}>
                      {r.createdReason ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CouponToggle couponId={r.id} active={r.active} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
