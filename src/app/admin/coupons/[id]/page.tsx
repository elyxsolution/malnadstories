import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { coupons, couponRedemptions, orders, profiles } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { adminUserEmails } from '@/lib/admin/users';
import { inr, shortId, fmtDate, fmtDateTime, statusChip } from '@/lib/admin/format';

export default async function AdminCouponDetail({ params }: { params: { id: string } }) {
  await requireAdmin();

  const [coupon] = await db.select().from(coupons).where(eq(coupons.id, params.id)).limit(1);
  if (!coupon) notFound();

  const reds = await db
    .select({
      orderId: couponRedemptions.orderId,
      userId: couponRedemptions.userId,
      amountDiscounted: couponRedemptions.amountDiscounted,
      redeemedAt: couponRedemptions.redeemedAt,
      orderTotal: orders.totalAmount,
      orderStatus: orders.status,
      customerName: profiles.name,
    })
    .from(couponRedemptions)
    .leftJoin(orders, eq(couponRedemptions.orderId, orders.id))
    .leftJoin(profiles, eq(couponRedemptions.userId, profiles.id))
    .where(eq(couponRedemptions.couponId, params.id))
    .orderBy(desc(couponRedemptions.redeemedAt));

  const totalDiscount = reds.reduce((s, r) => s + Number(r.amountDiscounted), 0);
  const revenue = reds.reduce((s, r) => s + Number(r.orderTotal ?? 0), 0);
  const customers = new Set(reds.map((r) => r.userId));
  const emails = await adminUserEmails(reds.map((r) => r.userId));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/coupons" className="hover:underline">
          Coupons
        </Link>
        {' / '}
        {coupon.code}
      </p>
      <h1 className="mt-1 font-mono text-xl font-bold">{coupon.code}</h1>
      {coupon.description && <p className="text-sm text-muted-foreground">{coupon.description}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Times used" value={String(coupon.currentUses)} />
        <Stat label="Discount granted" value={inr(totalDiscount)} />
        <Stat label="Revenue influenced" value={inr(revenue)} />
        <Stat label="Customers" value={String(customers.size)} />
      </div>

      <div className="mt-6 grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
        <Row label="Type" value={coupon.discountType} />
        <Row
          label="Value"
          value={coupon.discountType === 'flat' ? inr(coupon.discountValue) : `${Number(coupon.discountValue)}%`}
        />
        <Row label="Minimum order" value={coupon.minimumOrderAmount ? inr(coupon.minimumOrderAmount) : 'None'} />
        <Row label="Max uses" value={coupon.maxUses != null ? String(coupon.maxUses) : 'Unlimited'} />
        <Row label="Starts" value={fmtDate(coupon.startsAt as unknown as string)} />
        <Row label="Expires" value={fmtDate(coupon.expiresAt as unknown as string)} />
        <Row label="Active" value={coupon.active ? 'Yes' : 'No'} />
        <Row label="Created reason" value={coupon.createdReason ?? '—'} />
      </div>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Redemptions ({reds.length})</h2>
      {reds.length === 0 ? (
        <p className="text-sm text-muted-foreground">No redemptions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="ms-stack w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2 text-right">Discount</th>
                <th className="px-3 py-2 text-right">Order total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Redeemed</th>
              </tr>
            </thead>
            <tbody>
              {reds.map((r) => (
                <tr key={r.orderId} className="border-b last:border-0 hover:bg-muted/30">
                  <td data-label="Order" className="px-3 py-2">
                    <Link href={`/admin/orders/${r.orderId}`} className="font-mono text-primary hover:underline">
                      #{shortId(r.orderId)}
                    </Link>
                  </td>
                  <td data-label="Customer" data-block className="px-3 py-2">
                    <div>{r.customerName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{emails.get(r.userId) ?? ''}</div>
                  </td>
                  <td data-label="Discount" className="px-3 py-2 text-right">− {inr(r.amountDiscounted)}</td>
                  <td data-label="Order total" className="px-3 py-2 text-right">{inr(r.orderTotal)}</td>
                  <td data-label="Status" className="px-3 py-2">
                    {r.orderStatus && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusChip(r.orderStatus)}`}>
                        {r.orderStatus}
                      </span>
                    )}
                  </td>
                  <td data-label="Redeemed" className="px-3 py-2 text-muted-foreground">{fmtDateTime(r.redeemedAt as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right capitalize">{value}</span>
    </div>
  );
}
