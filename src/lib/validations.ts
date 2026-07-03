import { z } from 'zod';
import { nameSchema, passwordSchema } from '@/lib/auth/policy';
import { FONT_KEYS } from '@/lib/builder/fonts-catalog';

export const SignupSchema = z.object({
  // Password (8–25) + display-name (2–60, normalised) policy lives in one place
  // (lib/auth/policy) so signup / reset / profile / auth-callback can't drift.
  name: nameSchema,
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
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

export const CreateAlbumSchema = z
  .object({
    title: z
      .string()
      .min(1, 'Album title is required')
      .max(100, 'Title must be 100 characters or less'),
    productId: z.string().uuid('Please select an album size'),
    // Cover source (Phase 3). Exactly one path (or neither = blank custom cover):
    //   coverTemplateId       → legacy uploaded-PNG cover artwork (0023), kept for back-compat.
    //   coverDesignTemplateId → a full builder-JSON cover DESIGN template (0040); its CoverConfig
    //                           is copied into albums.cover_config, fully editable thereafter.
    // Both optional so "Custom Cover" (blank) is also valid; they are mutually exclusive.
    coverTemplateId: z.string().uuid('Please choose a cover design').optional(),
    coverDesignTemplateId: z.string().uuid('Invalid cover template').optional(),
    // Optional metadata (Phase 2A) — never gates creation.
    destination: optionalText(120, 'Destination must be 120 characters or less'),
    travelDates: optionalText(60, 'Travel dates must be 60 characters or less'),
    description: optionalText(500, 'Description must be 500 characters or less'),
  })
  .refine((d) => !(d.coverTemplateId && d.coverDesignTemplateId), {
    message: 'Choose either a cover artwork or a cover template, not both.',
    path: ['coverDesignTemplateId'],
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
// (quick crop). Both optional; defaults compose to a plain cover-fit. Tone & finish
// (contrast/saturation/grayscale/opacity/border-radius/shadow) are additive — absent
// fields render exactly as before.
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
  contrast: z.number().min(0).max(3).optional(),
  saturation: z.number().min(0).max(3).optional(),
  grayscale: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  borderRadius: z.number().min(0).max(0.5).optional(),
  shadow: z.number().min(0).max(1).optional(),
});

const OverlaySchema = z.object({
  // Nullable: an overlay is a photo CONTAINER that may be an empty placeholder (photoId=null).
  // Blueprints materialize placeholder overlays; a photo is assigned later (auto-fill / manual).
  photoId: z.string().uuid().nullable().default(null),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

// Rich page elements (text · QR · background) — stored in layout_config jsonb alongside
// `overlays`. Bounded + value-checked so a forged client can't store unbounded payloads.
const HexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Invalid colour');
const HexOrTransparent = z.union([HexColor, z.literal('transparent')]);

const TextElementSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(600).default(''),
  x: z.number().min(-0.5).max(1),
  y: z.number().min(-0.5).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
  variant: z.enum(['heading', 'subtitle', 'paragraph']),
  font: z.enum(FONT_KEYS),
  size: z.number().min(6).max(220),
  weight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  underline: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  color: HexColor,
  letterSpacing: z.number().min(-0.2).max(1),
  lineHeight: z.number().min(0.8).max(3),
  opacity: z.number().min(0).max(1),
  rotation: z.number().min(-180).max(180),
  shadow: z.boolean(),
});

const QrElementSchema = z.object({
  id: z.string().min(1).max(64),
  data: z.string().min(1).max(1024),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
  fg: HexColor,
  bg: HexOrTransparent,
  padding: z.number().min(0).max(0.4),
  radius: z.number().min(0).max(0.5),
});

const StickerElementSchema = z.object({
  id: z.string().min(1).max(64),
  stickerId: z.string().uuid(),
  x: z.number().min(-0.5).max(1),
  y: z.number().min(-0.5).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
  rotation: z.number().min(-180).max(180),
  opacity: z.number().min(0).max(1),
  // Additive optional transforms/state (builder sticker ops). Absent → renders as before.
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  locked: z.boolean().optional(),
});

const BackgroundSchema = z.object({
  kind: z.enum(['color', 'gradient', 'texture']),
  value: z.string().min(1).max(40),
});

const BlockSchema = z.object({
  template: z.enum(['single-pair', 'double-spread']),
  // single-pair: [leftId?, rightId?]; double-spread: [imageId?]. Up to 2 base slots.
  photoIds: z.array(z.string().uuid()).max(2),
  caption: z.string().max(200).optional().default(''),
  overlays: z.array(OverlaySchema).max(50).optional().default([]),
  texts: z.array(TextElementSchema).max(30).optional().default([]),
  qrs: z.array(QrElementSchema).max(10).optional().default([]),
  stickers: z.array(StickerElementSchema).max(30).optional().default([]),
  background: BackgroundSchema.nullable().optional().default(null),
  // The layout-preset id this block was built from (additive; for accurate blueprint breakdowns).
  preset: z.string().max(40).optional(),
});

export const SaveLayoutSchema = z
  .object({
    albumId: z.string().uuid('Invalid album'),
    blocks: z.array(BlockSchema).max(100),
  })
  .superRefine((data, ctx) => {
    // A photo may be placed at most once across the whole album — base OR overlay.
    // Empty overlay placeholders (photoId=null) carry no photo, so they never collide.
    const seen = new Set<string>();
    for (const b of data.blocks) {
      for (const id of [...b.photoIds, ...b.overlays.map((o) => o.photoId)]) {
        if (id == null) continue;
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

// The BACK cover composition — its own image source + free elements (no admin artwork). Bounded
// exactly like a content page so a forged client can't store unbounded payloads.
const BackCoverConfigSchema = z.object({
  background: BackgroundSchema.nullable().optional().default(null),
  photoId: z.string().uuid().nullable().optional().default(null),
  imageEdit: EditConfigSchema.nullable().optional().default(null),
  texts: z.array(TextElementSchema).max(30).optional().default([]),
  stickers: z.array(StickerElementSchema).max(30).optional().default([]),
  qrs: z.array(QrElementSchema).max(10).optional().default([]),
  showLogo: z.boolean().optional().default(false),
});

// Custom cover DESIGN — front (top-level) + spine + back composition. Stored in
// albums.cover_config (0038). Bounded so a forged client can't store unbounded payloads.
// Exported so the admin cover-DESIGN-template schemas (0040) reuse the exact same bounded
// shape — an admin template IS a CoverConfig snapshot, so there is one validation source.
export const CoverConfigSchema = z.object({
  subtitle: z.string().max(120).optional().default(''),
  author: z.string().max(80).optional().default(''),
  spineTitle: z.string().max(80).optional().default(''),
  spineColor: HexColor.optional().default('#ffffff'),
  font: z.enum(FONT_KEYS).optional().default('serif'),
  color: HexColor.optional().default('#ffffff'),
  align: z.enum(['left', 'center', 'right']).optional().default('center'),
  layout: z.enum(['classic', 'spotlight', 'banner', 'minimal']).optional().default('classic'),
  posY: z.number().min(0.1).max(0.95).optional().default(0.8),
  background: BackgroundSchema.nullable().optional().default(null),
  photoId: z.string().uuid().nullable().optional().default(null),
  imageEdit: EditConfigSchema.nullable().optional().default(null),
  // Free elements on the FRONT cover — identical to page elements (Cover-as-page-0).
  texts: z.array(TextElementSchema).max(30).optional().default([]),
  stickers: z.array(StickerElementSchema).max(30).optional().default([]),
  qrs: z.array(QrElementSchema).max(10).optional().default([]),
  back: BackCoverConfigSchema.optional().default({
    background: null,
    photoId: null,
    imageEdit: null,
    texts: [],
    stickers: [],
    qrs: [],
    showLogo: false,
  }),
});

export const CoverDesignSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  title: z.string().trim().min(1, 'Album title is required').max(100, 'Title must be 100 characters or less'),
  // Base cover artwork (admin template). Null = no template image (use a photo/background).
  coverTemplateId: z.string().uuid('Invalid cover').nullable().optional().default(null),
  config: CoverConfigSchema,
});

export type CoverDesignInput = z.infer<typeof CoverDesignSchema>;

// ── Admin: cover DESIGN templates (0040) ──────────────────────────────────────
// An admin cover template IS a CoverConfig snapshot (reuses CoverConfigSchema above), built
// in the same cover editor. status/slug/actor are server/DB controlled (status defaults to
// 'inactive' on create). Mirrors TemplateSaveSchema (layout templates).
const COVER_TEMPLATE_CATEGORY_VALUES = [
  'general', 'travel', 'wedding', 'minimal', 'bold', 'classic', 'seasonal',
] as const;
const COVER_TEMPLATE_STATUS_VALUES = ['active', 'inactive', 'archived'] as const;

export const CoverTemplateSaveSchema = z.object({
  id: z.string().uuid().optional(), // present = update; absent = create
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  slug: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'Slug must be lowercase letters, numbers and dashes.').optional(),
  ),
  description: z.string().trim().max(500, 'Description is too long').optional(),
  category: z.enum(COVER_TEMPLATE_CATEGORY_VALUES).default('general'),
  featured: z.boolean().optional().default(false),
  // Merchandising flags (0041) — additive, default false.
  popular: z.boolean().optional().default(false),
  pinned: z.boolean().optional().default(false),
  config: CoverConfigSchema,
});

export const CoverTemplateStatusSchema = z.object({
  id: z.string().uuid('Invalid template'),
  status: z.enum(COVER_TEMPLATE_STATUS_VALUES),
});

export const CoverTemplateFeatureSchema = z.object({
  id: z.string().uuid('Invalid template'),
  featured: z.boolean(),
});

export const CoverTemplateReorderSchema = z.object({
  // Ordered list of template ids → their new sort index is the array position.
  ids: z.array(z.string().uuid()).min(1, 'Nothing to reorder').max(500, 'Too many items'),
});

export const CoverTemplateDuplicateSchema = z.object({
  id: z.string().uuid('Invalid template'),
});

// ── Cover template import/export (Task 2) ──────────────────────────────────────
// A portable, versioned template file. schemaVersion gates compatibility (reject others).
// The body reuses the SAME bounded field rules as save + CoverConfigSchema, so an imported
// file can never carry a shape the editor/renderer can't handle. IDs/slug/status are NOT part
// of the payload — an import always mints a fresh row (or overwrites a chosen target's content).
export const COVER_TEMPLATE_EXPORT_VERSION = 1 as const;

export const CoverTemplateImportSchema = z.object({
  schemaVersion: z.literal(COVER_TEMPLATE_EXPORT_VERSION, {
    message: `Unsupported template file version (expected ${COVER_TEMPLATE_EXPORT_VERSION}).`,
  }),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  description: z.string().trim().max(500).optional(),
  category: z.enum(COVER_TEMPLATE_CATEGORY_VALUES).default('general'),
  featured: z.boolean().optional().default(false),
  popular: z.boolean().optional().default(false),
  pinned: z.boolean().optional().default(false),
  config: CoverConfigSchema,
});

// Wraps the file with an optional overwrite target. overwriteId present → replace that row's
// content; absent → create a fresh (inactive) template.
export const CoverTemplateImportRequestSchema = z.object({
  overwriteId: z.string().uuid().optional(),
  data: CoverTemplateImportSchema,
});

export type CoverTemplateImport = z.infer<typeof CoverTemplateImportSchema>;
export type CoverTemplateSaveInput = z.infer<typeof CoverTemplateSaveSchema>;
export type CoverTemplateStatusInput = z.infer<typeof CoverTemplateStatusSchema>;

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

// ── Admin: stickers ──────────────────────────────────────────────────────────
// Admin uploads sticker artwork to R2 (presign → PUT), then registers it. Image only
// (transparent PNG recommended). Mirrors the cover admin schemas.
export const StickerPresignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES, {
    message: 'Only JPEG, PNG, HEIC, or WebP images are allowed',
  }),
  size: z.number().int().positive('File is empty').max(MAX_UPLOAD_BYTES, 'Each file must be 20 MB or smaller'),
});

export const CreateStickerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  categoryId: z.string().uuid('Invalid category').nullable().optional().default(null),
  imageKey: z.string().min(1).max(512),
  sort: z.number().int().min(0).max(9999).optional().default(0),
});

// Tag list — bounded searchable keywords. Normalised (lowercased, de-duped) in the action.
const StickerTagsSchema = z
  .array(z.string().trim().min(1).max(30))
  .max(20, 'Too many tags (max 20)')
  .optional()
  .default([]);

export const RenameStickerSchema = z.object({
  stickerId: z.string().uuid('Invalid sticker'),
  name: z.string().trim().min(1, 'Name is required').max(100),
  categoryId: z.string().uuid('Invalid category').nullable().optional().default(null),
  tags: StickerTagsSchema,
});

export const SetStickerActiveSchema = z.object({
  stickerId: z.string().uuid('Invalid sticker'),
  active: z.boolean(),
});

export const DeleteStickerSchema = z.object({
  stickerId: z.string().uuid('Invalid sticker'),
});

// Replace a sticker's artwork with a freshly-uploaded R2 object (key under stickers/…).
export const ReplaceStickerArtworkSchema = z.object({
  stickerId: z.string().uuid('Invalid sticker'),
  imageKey: z.string().min(1).max(512),
});

// Persist a new display order (array position = sort index).
export const ReorderStickersSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Nothing to reorder').max(1000, 'Too many items'),
});

// Bulk operations over a selection of sticker ids.
export const BulkStickerActiveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one sticker').max(500, 'Too many items'),
  active: z.boolean(),
});
export const BulkStickerDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one sticker').max(500, 'Too many items'),
});

export const CreateStickerCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});

export const RenameStickerCategorySchema = z.object({
  categoryId: z.string().uuid('Invalid category'),
  name: z.string().trim().min(1, 'Name is required').max(60),
});

export const DeleteStickerCategorySchema = z.object({
  categoryId: z.string().uuid('Invalid category'),
});

export const ReorderStickerCategoriesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Nothing to reorder').max(200, 'Too many items'),
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

// ── Support Center (0028) ─────────────────────────────────────────────────────
// Mirrors the DB CHECK enums (lib/support/model). Customer-facing inputs only allow
// the calmer category/priority subset; admin status changes are a separate schema.

const SUPPORT_CATEGORY_VALUES = [
  'order', 'payment', 'upload', 'album', 'delivery', 'refund', 'technical', 'other',
] as const;

// A customer opens a ticket. customer_id is taken from the JWT (never input); status
// is forced to 'open' server-side. Linked album/order are optional + ownership is
// re-checked in the action AND by the RLS WITH CHECK policy.
export const CreateTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Add a short subject').max(140, 'Subject is too long'),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(4000, 'Message is too long'),
  category: z.enum(SUPPORT_CATEGORY_VALUES).default('other'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  albumId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
});

export const TicketReplySchema = z.object({
  ticketId: z.string().uuid('Invalid ticket'),
  body: z.string().trim().min(1, 'Write a reply').max(4000, 'Message is too long'),
});

export const AdminTicketReplySchema = z.object({
  ticketId: z.string().uuid('Invalid ticket'),
  body: z.string().trim().min(1, 'Write a reply').max(4000, 'Message is too long'),
  internal: z.boolean().optional().default(false),
});

export const AdminTicketStatusSchema = z.object({
  ticketId: z.string().uuid('Invalid ticket'),
  status: z.enum(['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed']),
});

export const AdminTicketAssignSchema = z.object({
  ticketId: z.string().uuid('Invalid ticket'),
  // true = assign to the acting admin (resolved server-side from requireAdmin);
  // false = unassign. The client never supplies a user id.
  assign: z.boolean(),
});

export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;
export type TicketReplyInput = z.infer<typeof TicketReplySchema>;

// ── Refund & Reprint requests (0029) ──────────────────────────────────────────
// Mirrors the DB CHECK enums (lib/resolutions/model). customer_id, status,
// admin_notes and resolved_* are NEVER input — they are server/DB controlled.

const REFUND_REASON_VALUES = [
  'damaged_product', 'wrong_product', 'late_delivery', 'quality_issue', 'duplicate_order', 'other',
] as const;
const REPRINT_ISSUE_VALUES = [
  'damaged_delivery', 'print_quality', 'wrong_album', 'missing_pages', 'binding_issue', 'other',
] as const;
const REQUEST_STATUS_VALUES = ['pending', 'under_review', 'approved', 'rejected', 'completed'] as const;

export const CreateRefundSchema = z.object({
  orderId: z.string().uuid('Select an order'),
  reason: z.enum(REFUND_REASON_VALUES),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(4000, 'Message is too long'),
  supportTicketId: z.string().uuid().optional(),
});

export const CreateReprintSchema = z.object({
  orderId: z.string().uuid('Select an order'),
  issueType: z.enum(REPRINT_ISSUE_VALUES),
  description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(4000, 'Message is too long'),
  supportTicketId: z.string().uuid().optional(),
});

// Admin decision. status drives the RPC's forward-only state machine; note is optional
// and stored on the request + audited.
export const AdminRequestStatusSchema = z.object({
  requestId: z.string().uuid('Invalid request'),
  status: z.enum(REQUEST_STATUS_VALUES),
  note: z.string().trim().max(2000, 'Note too long').optional(),
});

export const AdminRequestNoteSchema = z.object({
  requestId: z.string().uuid('Invalid request'),
  note: z.string().trim().min(1, 'Note cannot be empty').max(2000, 'Note too long'),
});

export type CreateRefundInput = z.infer<typeof CreateRefundSchema>;
export type CreateReprintInput = z.infer<typeof CreateReprintSchema>;

// ── Album Review & Request-Changes (0030) ─────────────────────────────────────
// Mirrors the DB CHECK enums (lib/reviews/model). status/customer_id/reviewed_* are
// NEVER input — they are server/DB controlled. The admin decision surface is only
// approve / request-changes / reject; 'changes_requested' REQUIRES the notes (they are
// the requested changes shown to the customer).

export const AdminReviewDecisionSchema = z
  .object({
    reviewId: z.string().uuid('Invalid review'),
    status: z.enum(['approved', 'changes_requested', 'rejected']),
    notes: z.string().trim().max(2000, 'Note too long').optional(),
  })
  .superRefine((d, ctx) => {
    if (d.status === 'changes_requested' && (!d.notes || d.notes.length < 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['notes'],
        message: 'Describe the changes to request (at least 10 characters).',
      });
    }
  });

export const AdminReviewNoteSchema = z.object({
  reviewId: z.string().uuid('Invalid review'),
  note: z.string().trim().min(1, 'Note cannot be empty').max(2000, 'Note too long'),
});

// Customer "I'm opening the builder to work on this revision" signal. albumId only.
export const OpenRevisionSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
});

export type AdminReviewDecisionInput = z.infer<typeof AdminReviewDecisionSchema>;
export type AdminReviewNoteInput = z.infer<typeof AdminReviewNoteSchema>;

// ── CMS & Content Management (0031) ───────────────────────────────────────────
// Mirrors the DB CHECK enums (lib/cms/model). status/published_at/created_by/updated_by
// are NEVER set from these inputs — they are server/DB controlled. metadata holds the
// per-type extras (kept permissive here; per-type specifics are lightly checked).

const CONTENT_TYPE_VALUES = [
  'blog', 'faq', 'testimonial', 'legacy_story', 'homepage_section', 'announcement',
] as const;
const CONTENT_STATUS_VALUES = ['draft', 'published', 'archived'] as const;

// metadata: a flat record of strings / numbers / booleans (per-type keys defined in the
// model config). Bounded to keep payloads sane.
const CmsMetadataSchema = z
  .record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean()]))
  .optional()
  .default({});

export const CmsSaveSchema = z
  .object({
    id: z.string().uuid().optional(), // present = update; absent = create
    type: z.enum(CONTENT_TYPE_VALUES),
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
    // Optional explicit slug; when omitted the server derives one from the title.
    slug: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
        z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'Slug must be lowercase letters, numbers and dashes.').optional(),
      ),
    excerpt: z.string().trim().max(500, 'Excerpt is too long').optional(),
    content: z.string().max(20000, 'Content is too long').optional(),
    coverImage: z
      .preprocess(
        (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
        z.string().url('Cover image must be a valid URL').max(1000).optional(),
      ),
    metadata: CmsMetadataSchema,
  })
  .superRefine((d, ctx) => {
    // Testimonial rating, when present, must be an integer 1–5.
    if (d.type === 'testimonial') {
      const r = d.metadata?.rating;
      if (r !== undefined && (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5)) {
        ctx.addIssue({ code: 'custom', path: ['metadata', 'rating'], message: 'Rating must be a whole number from 1 to 5.' });
      }
    }
  });

export const CmsStatusSchema = z.object({
  id: z.string().uuid('Invalid content'),
  status: z.enum(CONTENT_STATUS_VALUES),
});

export const CmsBulkStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select at least one item').max(100, 'Too many items'),
  status: z.enum(CONTENT_STATUS_VALUES),
});

export const CmsDuplicateSchema = z.object({
  id: z.string().uuid('Invalid content'),
});

export type CmsSaveInput = z.infer<typeof CmsSaveSchema>;
export type CmsStatusInput = z.infer<typeof CmsStatusSchema>;

// ── Template Management (0032) ────────────────────────────────────────────────
// Mirrors the DB CHECK enums (lib/templates/model). geometry is shape-checked here AND
// re-validated by validateGeometry() in the action + activation gate. status/slug/actor are
// server/DB controlled (status defaults to 'inactive' on create).

const TEMPLATE_CATEGORY_VALUES = ['solo', 'pair', 'collage', 'panoramic', 'story'] as const;
const TEMPLATE_STATUS_VALUES = ['active', 'inactive', 'archived'] as const;

const GeometryRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

// base ∈ the existing renderer primitives; overlays are numeric rects (≤ 50). Deeper bounds
// (x+w≤1, finiteness) are enforced by validateGeometry() — re-run server-side before write.
const TemplateGeometrySchema = z.object({
  base: z.enum(['single-pair', 'double-spread']),
  overlays: z.array(GeometryRectSchema).max(50).default([]),
});

export const TemplateSaveSchema = z.object({
  id: z.string().uuid().optional(), // present = update; absent = create
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  slug: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'Slug must be lowercase letters, numbers and dashes.').optional(),
  ),
  description: z.string().trim().max(500, 'Description is too long').optional(),
  category: z.enum(TEMPLATE_CATEGORY_VALUES),
  geometry: TemplateGeometrySchema,
  previewImage: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().url('Preview image must be a valid URL').max(1000).optional(),
  ),
});

export const TemplateStatusSchema = z.object({
  id: z.string().uuid('Invalid template'),
  status: z.enum(TEMPLATE_STATUS_VALUES),
});

export const TemplateDuplicateSchema = z.object({
  id: z.string().uuid('Invalid template'),
});

// Safe delete of a layout PRESET — gated by a dependency check on the stored per-block preset keys.
export const LayoutPresetIdSchema = z.object({
  id: z.string().uuid('Invalid preset'),
});

export type TemplateSaveInput = z.infer<typeof TemplateSaveSchema>;
export type TemplateStatusInput = z.infer<typeof TemplateStatusSchema>;

// ── Album Blueprints (0043) ────────────────────────────────────────────────────
// A whole-album blueprint = a sequence of page units, each a layout primitive + EMPTY overlay
// slots (geometry, no photo) + decorative elements. Reuses the SAME bounded element schemas as
// album blocks, so an imported/authored blueprint can never carry a shape the renderer can't
// handle. Applying it produces ordinary album Block[] (photos assigned to slots).
const BlueprintBlockSchema = z.object({
  template: z.enum(['single-pair', 'double-spread']),
  caption: z.string().max(200).optional().default(''),
  overlaySlots: z.array(RectSchema).max(50).optional().default([]),
  texts: z.array(TextElementSchema).max(30).optional().default([]),
  qrs: z.array(QrElementSchema).max(10).optional().default([]),
  stickers: z.array(StickerElementSchema).max(30).optional().default([]),
  background: BackgroundSchema.nullable().optional().default(null),
});

export const BlueprintSchema = z.object({
  version: z.literal(1),
  blocks: z.array(BlueprintBlockSchema).min(1, 'A blueprint needs at least one page').max(100, 'Too many pages'),
});


export const UpdateBlueprintMetaSchema = z.object({
  id: z.string().uuid('Invalid blueprint'),
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  description: z.string().trim().max(500, 'Description is too long').optional(),
  category: z.enum(TEMPLATE_CATEGORY_VALUES),
});

export const BlueprintFeatureSchema = z.object({
  id: z.string().uuid('Invalid blueprint'),
  featured: z.boolean().optional(),
  popular: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const BlueprintReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Nothing to reorder').max(500, 'Too many items'),
});

export const BlueprintDeleteSchema = z.object({
  id: z.string().uuid('Invalid blueprint'),
});

// Set (or clear) the ONE default blueprint for its album size (0045). Auto Create uses it.
export const SetBlueprintDefaultSchema = z.object({
  id: z.string().uuid('Invalid blueprint'),
  isDefault: z.boolean().optional().default(true),
});

// Create a BLANK blueprint of a chosen album size + open it in the builder (New Blueprint flow).
// The size is re-validated against active products server-side (data-driven — no size literal here).
export const CreateBlankBlueprintSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  size: z.number().int('Invalid size').positive('Invalid size'),
  category: z.enum(TEMPLATE_CATEGORY_VALUES).default('story'),
});

// Open a blueprint for editing in the builder (0046) — creates a draft album from it.
export const OpenBlueprintForEditingSchema = z.object({
  id: z.string().uuid('Invalid blueprint'),
});

// Save the edited draft album back into its SAME blueprint (0046).
export const UpdateBlueprintFromAlbumSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
});

// Apply a blueprint to a NEW album at creation (Phase C). autoPlace fills the slots with the
// album's uploaded photos; seed makes "randomize" reproducible.
export const ApplyBlueprintSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  blueprintId: z.string().uuid('Invalid blueprint'),
  autoPlace: z.boolean().optional().default(true),
  seed: z.number().int().optional(),
});

// ── Courier & Shipping (0033) ─────────────────────────────────────────────────
// Mirrors the DB CHECK enums (lib/shipping/model). shipment_status/external_reference are
// server/DB/provider controlled — never client input beyond the bounded fields below.

const COURIER_VALUES = ['shiprocket', 'delhivery', 'bluedart', 'dtdc', 'other'] as const;
const SHIPMENT_STATUS_VALUES = [
  'created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'failed',
] as const;

const TrackingNumberSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
  z.string().min(3, 'Tracking number too short').max(64, 'Tracking number too long').optional(),
);

export const ShipmentCreateSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
  courier: z.enum(COURIER_VALUES),
  trackingNumber: TrackingNumberSchema,
});

export const ShipmentUpdateSchema = z.object({
  shipmentId: z.string().uuid('Invalid shipment'),
  courier: z.enum(COURIER_VALUES).optional(),
  trackingNumber: TrackingNumberSchema,
});

export const ShipmentStatusSchema = z.object({
  shipmentId: z.string().uuid('Invalid shipment'),
  status: z.enum(SHIPMENT_STATUS_VALUES),
});

export const ShipmentIdSchema = z.object({
  shipmentId: z.string().uuid('Invalid shipment'),
});

export type ShipmentCreateInput = z.infer<typeof ShipmentCreateSchema>;
export type ShipmentStatusInput = z.infer<typeof ShipmentStatusSchema>;

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
