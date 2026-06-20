import { z } from 'zod';

export const SignupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Optional free-text album metadata (0026). Empty strings normalise to undefined so a
// blank field stores NULL rather than ''.
const optionalText = (max: number, msg: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().max(max, msg).optional(),
  );

export const CreateAlbumSchema = z.object({
  title: z
    .string()
    .min(1, 'Album title is required')
    .max(100, 'Title must be 100 characters or less'),
  productId: z.string().uuid('Please select an album size'),
  // Cover is chosen at creation (Phase F.1) — mandatory, must be an active template.
  coverTemplateId: z.string().uuid('Please choose a cover design'),
  // Optional metadata (Phase 2A) — never gates creation.
  destination: optionalText(120, 'Destination must be 120 characters or less'),
  travelDates: optionalText(60, 'Travel dates must be 60 characters or less'),
  description: optionalText(500, 'Description must be 500 characters or less'),
});

// Photo upload — presign + confirm. Mirrors the server-side limits in src/lib/r2.ts.
const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'] as const;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export const PresignUploadSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES, {
    message: 'Only JPEG, PNG, HEIC, or WebP images are allowed',
  }),
  size: z
    .number()
    .int()
    .positive('File is empty')
    .max(MAX_UPLOAD_BYTES, 'Each file must be 20 MB or smaller'),
});

export const ConfirmUploadSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  key: z.string().min(1).max(512),
  originalFilename: z.string().min(1).max(255),
});

// ── Album builder ──────────────────────────────────────────────────────────
// Layout save + per-photo edit. Accounting/completeness gates are enforced in
// the server actions (they need the album size from the DB), not here.

const RectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

// Two composable crop systems: free-form `crop` (full editor) + fixed-frame zoom/pan
// (quick crop). Both optional; defaults compose to a plain cover-fit.
export const EditConfigSchema = z.object({
  crop: RectSchema.optional(),
  zoom: z.number().min(1).max(5).optional(),
  offsetX: z.number().min(-1).max(1).optional(),
  offsetY: z.number().min(-1).max(1).optional(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  tilt: z.number().min(-15).max(15).optional(),
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  brightness: z.number().min(0).max(3).optional(),
  sharpness: z.number().min(0).max(3).optional(),
});

const OverlaySchema = z.object({
  photoId: z.string().uuid(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

const BlockSchema = z.object({
  template: z.enum(['single-pair', 'double-spread']),
  // single-pair: [leftId?, rightId?]; double-spread: [imageId?]. Up to 2 base slots.
  photoIds: z.array(z.string().uuid()).max(2),
  caption: z.string().max(200).optional().default(''),
  overlays: z.array(OverlaySchema).max(50).optional().default([]),
});

export const SaveLayoutSchema = z
  .object({
    albumId: z.string().uuid('Invalid album'),
    blocks: z.array(BlockSchema).max(100),
  })
  .superRefine((data, ctx) => {
    // A photo may be placed at most once across the whole album — base OR overlay.
    const seen = new Set<string>();
    for (const b of data.blocks) {
      for (const id of [...b.photoIds, ...b.overlays.map((o) => o.photoId)]) {
        if (seen.has(id)) {
          ctx.addIssue({ code: 'custom', message: 'A photo cannot be placed more than once' });
          return;
        }
        seen.add(id);
      }
    }
  });

export const PhotoEditSchema = z.object({
  photoId: z.string().uuid('Invalid photo'),
  edit: EditConfigSchema,
});

// User selecting a cover design for their album (authenticated + RLS on the album).
export const SelectCoverSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  coverTemplateId: z.string().uuid('Invalid cover'),
});

// ── Admin: cover templates ───────────────────────────────────────────────────
// Admin uploads cover artwork to R2 (presign → PUT), then registers it. Image only.
export const CoverPresignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES, {
    message: 'Only JPEG, PNG, HEIC, or WebP images are allowed',
  }),
  size: z.number().int().positive('File is empty').max(MAX_UPLOAD_BYTES, 'Each file must be 20 MB or smaller'),
});

export const CreateCoverSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(300).optional(),
  imageKey: z.string().min(1).max(512),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});

export const SetCoverActiveSchema = z.object({
  coverTemplateId: z.string().uuid('Invalid cover'),
  active: z.boolean(),
});

export const DeleteCoverSchema = z.object({
  coverTemplateId: z.string().uuid('Invalid cover'),
});

// ── Addresses & checkout ─────────────────────────────────────────────────────

export const AddressSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(100),
  line1: z.string().min(1, 'Address is required').max(200),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional().default(false),
});

// Delivery tier (Phase 2B). The client sends only the tier KEY; the server resolves
// the fee (lib/shipping). Defaults to 'standard' so older callers are unaffected.
const ShippingMethodSchema = z
  .enum(['standard', 'priority', 'express'])
  .default('standard');

// Coupon codes accepted at checkout. Now that admins can mint custom codes (Phase 2C)
// the pattern is a general uppercase code (was MS-XXXXXXXX only) — still strictly
// validated + uppercased; the real authority is validateCoupon against the DB.
const CouponCodeSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toUpperCase() : undefined),
  z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, 'That coupon code is not valid.').optional(),
);

// Checkout inputs carry NO amount — the total is always computed server-side from
// the album's product × copies − coupon + shipping tier. Only references cross.
export const CreateOrderSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  addressId: z.string().uuid('Please select a delivery address'),
  copies: z.number().int().min(1, 'At least 1 copy').max(10, 'Maximum 10 copies').default(1),
  shippingMethod: ShippingMethodSchema,
  couponCode: CouponCodeSchema,
});

export const CancelOrderSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
});

// Live discount preview on the checkout page (advisory; createOrder recomputes).
export const PreviewCouponSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  copies: z.number().int().min(1).max(10),
  shippingMethod: ShippingMethodSchema,
  code: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().min(1, 'Enter a coupon code').max(20),
  ),
});

// Server-side price for a copy count + tier (no coupon) — advisory checkout preview.
export const PreviewOrderSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  copies: z.number().int().min(1).max(10),
  shippingMethod: ShippingMethodSchema,
});

// ── Admin ────────────────────────────────────────────────────────────────────

/** Shipping carriers (allow-list — admin tracking forms validate against this). */
export const CARRIERS = [
  'Delhivery',
  'Blue Dart',
  'DTDC',
  'India Post',
  'Ekart',
  'Xpressbees',
  'Shadowfax',
  'Other',
] as const;

// Admin may only advance fulfilment (forward-only; the RPC enforces adjacency).
export const UpdateOrderStatusSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
  status: z.enum(['processing', 'printing', 'packed', 'shipped', 'delivered']),
});

export const SetTrackingSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
  trackingNumber: z.string().trim().min(3, 'Tracking number too short').max(64, 'Tracking number too long'),
  carrier: z.enum(CARRIERS),
});

export const AddOrderNoteSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
  body: z.string().trim().min(1, 'Note cannot be empty').max(2000, 'Note too long'),
});

// Code: optionally admin-supplied (Phase 2C). When omitted, the action generates an
// MS-XXXXXXXX code. When provided it is uppercased + format-checked here; DB uniqueness
// (unique(upper(code))) is the real guard. Blank → undefined → auto-generate.
export const CreateCouponSchema = z
  .object({
    code: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toUpperCase() : undefined),
      z
        .string()
        .regex(/^[A-Z0-9][A-Z0-9-]{2,19}$/, 'Code must be 3–20 chars: letters, numbers or dashes.')
        .optional(),
    ),
    description: z.string().trim().max(200).optional(),
    createdReason: z.string().trim().max(300).optional(),
    discountType: z.enum(['flat', 'percentage']),
    discountValue: z.number().positive('Discount must be positive'),
    minimumOrderAmount: z.number().nonnegative().optional(),
    maxUses: z.number().int().positive().optional(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    active: z.boolean().default(true),
  })
  .refine((d) => d.discountType !== 'percentage' || d.discountValue <= 100, {
    message: 'Percentage discount cannot exceed 100',
    path: ['discountValue'],
  })
  .refine((d) => !d.startsAt || !d.expiresAt || new Date(d.expiresAt) > new Date(d.startsAt), {
    message: 'Expiry must be after the start date',
    path: ['expiresAt'],
  });

export const SetCouponActiveSchema = z.object({
  couponId: z.string().uuid('Invalid coupon'),
  active: z.boolean(),
});

export type AddressInput = z.infer<typeof AddressSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

export type EditConfigInput = z.infer<typeof EditConfigSchema>;
export type SaveLayoutInput = z.infer<typeof SaveLayoutSchema>;
export type PhotoEditInput = z.infer<typeof PhotoEditSchema>;

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateAlbumInput = z.infer<typeof CreateAlbumSchema>;
export type PresignUploadInput = z.infer<typeof PresignUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof ConfirmUploadSchema>;
