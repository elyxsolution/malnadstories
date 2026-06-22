import { z } from 'zod';
import { nameSchema, passwordSchema } from '@/lib/auth/policy';

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

export type TemplateSaveInput = z.infer<typeof TemplateSaveSchema>;
export type TemplateStatusInput = z.infer<typeof TemplateStatusSchema>;

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
