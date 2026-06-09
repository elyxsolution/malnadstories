'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { requireAdmin } from '@/lib/auth/require-admin';
import { CreateCouponSchema, SetCouponActiveSchema } from '@/lib/validations';
import { generateCouponCode } from '@/lib/coupons';

export type CreateCouponResult = { ok: true; code: string } | { ok: false; error: string };
export type AdminActionResult = { ok: true } | { ok: false; error: string };

/**
 * Create a coupon. The CODE is generated server-side (never accepted from the client)
 * and persisted via the audited admin_create_coupon RPC; on the rare code collision
 * (unique(upper(code)) → 23505) we regenerate and retry.
 */
export async function createCoupon(input: unknown): Promise<CreateCouponResult> {
  let actor: { userId: string };
  try {
    actor = await requireAdmin();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = CreateCouponSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const svc = createServiceClient();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCouponCode();
    const { data, error } = await svc.rpc('admin_create_coupon', {
      p_code: code,
      p_description: d.description ?? null,
      p_created_reason: d.createdReason ?? null,
      p_discount_type: d.discountType,
      p_discount_value: d.discountValue,
      p_minimum_order_amount: d.minimumOrderAmount ?? null,
      p_max_uses: d.maxUses ?? null,
      p_starts_at: d.startsAt ?? null,
      p_expires_at: d.expiresAt ?? null,
      p_actor_id: actor.userId,
    });
    if (error?.code === '23505') continue; // code collision → regenerate
    if (error || !data) {
      console.error('[admin] createCoupon rpc error', error);
      return { ok: false, error: 'Could not create the coupon.' };
    }
    // Created active by default; honour an explicit "create disabled" via the RPC.
    if (!d.active) {
      await svc.rpc('admin_set_coupon_active', {
        p_coupon_id: data,
        p_active: false,
        p_actor_id: actor.userId,
      });
    }
    revalidatePath('/admin/coupons');
    return { ok: true, code };
  }
  return { ok: false, error: 'Could not generate a unique code. Please try again.' };
}

/** Enable or disable a coupon (audited). */
export async function setCouponActive(input: unknown): Promise<AdminActionResult> {
  let actor: { userId: string };
  try {
    actor = await requireAdmin();
  } catch {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = SetCouponActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { couponId, active } = parsed.data;

  const svc = createServiceClient();
  const { data, error } = await svc.rpc('admin_set_coupon_active', {
    p_coupon_id: couponId,
    p_active: active,
    p_actor_id: actor.userId,
  });
  if (error) {
    console.error('[admin] setCouponActive rpc error', error);
    return { ok: false, error: 'Could not update the coupon.' };
  }
  if (data !== 'ok') return { ok: false, error: 'Coupon not found.' };

  revalidatePath('/admin/coupons');
  return { ok: true };
}
