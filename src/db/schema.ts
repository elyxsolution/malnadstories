import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  name: text('name'),
  phone: text('phone'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const addresses = pgTable('addresses', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  line1: text('line1').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  pincode: text('pincode').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  pages: integer('pages').notNull(),
  basePrice: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
  coverTypes: text('cover_types').array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const albums = pgTable('albums', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  size: integer('size').notNull(),
  status: text('status').notNull().default('draft'),
  // Optional customer-authored metadata (0026). Free text; authored at creation,
  // editable later. Never gates anything — display only.
  destination: text('destination'),
  travelDates: text('travel_dates'),
  description: text('description'),
  // Selected cover design (admin-managed template). Null until chosen; required to
  // submit / generate the PDF. ON DELETE SET NULL handled in 0023.
  coverTemplateId: uuid('cover_template_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Admin-managed cover catalogue (0023). Artwork bytes live in private R2 under
// cover-templates/…; only metadata + keys here. Users SELECT active rows to pick a
// cover; admins write via service-role. Served by presigned GET like photos.
export const coverTemplates = pgTable('cover_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  description: text('description'),
  imageKey: text('image_key').notNull(),
  thumbKey: text('thumb_key'),
  width: integer('width'),
  height: integer('height'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const albumPages = pgTable('album_pages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  albumId: uuid('album_id')
    .notNull()
    .references(() => albums.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number').notNull(),
  layoutTemplate: text('layout_template'),
  caption: text('caption'),
  photoIds: uuid('photo_ids').array().notNull().default(sql`'{}'::uuid[]`),
  layoutConfig: jsonb('layout_config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const photos = pgTable('photos', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  albumId: uuid('album_id').references(() => albums.id, { onDelete: 'set null' }),
  r2Key: text('r2_key'),
  originalFilename: text('original_filename').notNull(),
  editConfig: jsonb('edit_config'),
  status: text('status').notNull().default('pending'),
  sanitizedKey: text('sanitized_key'),
  thumbKey: text('thumb_key'),
  width: integer('width'),
  height: integer('height'),
  takenAt: timestamp('taken_at', { withTimezone: true }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  albumId: uuid('album_id')
    .notNull()
    .references(() => albums.id),
  addressId: uuid('address_id')
    .notNull()
    .references(() => addresses.id),
  status: text('status').notNull().default('pending'),
  // Pricing breakdown — all server-computed (0014). total = subtotal + shipping - discount.
  copies: integer('copies').notNull().default(1),
  subtotalAmount: numeric('subtotal_amount', { precision: 10, scale: 2 }).notNull(),
  shippingAmount: numeric('shipping_amount', { precision: 10, scale: 2 }).notNull().default('99'),
  // Chosen delivery tier (0027). Server resolves the fee from lib/shipping; this is
  // the tier label. Default 'standard' keeps existing rows + flow unchanged.
  shippingMethod: text('shipping_method').notNull().default('standard'),
  discountAmount: numeric('discount_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  couponId: uuid('coupon_id'), // FK → coupons (0015); kept loose here (hand-written SQL owns the FK)
  // Fulfillment (0014)
  trackingNumber: text('tracking_number'),
  carrier: text('carrier'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  razorpayOrderId: text('razorpay_order_id'),
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const albumPdfs = pgTable('album_pdfs', {
  albumId: uuid('album_id')
    .primaryKey()
    .references(() => albums.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('idle'),
  r2Key: text('r2_key'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  error: text('error'),
  tokenHash: text('token_hash'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  tokenUsedAt: timestamp('token_used_at', { withTimezone: true }),
  // Reliability/recovery (0025): when the current attempt started + how many attempts
  // have been driven, so the worker sweep can time out + cap retries.
  requestedAt: timestamp('requested_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  razorpayPaymentId: text('razorpay_payment_id'),
  method: text('method'),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  status: text('status').notNull().default('pending'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
});

// Service-only idempotency log for Razorpay webhooks (see 0010). Keyed by
// X-Razorpay-Event-Id; RLS is ON with no policies, so only the service role
// touches it (via process_razorpay_event). Never read by user-facing code.
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Admin / fulfillment (Phase 1) ────────────────────────────────────────────

// Discount coupons (0015). Codes stored UPPER; usable predicate lives in the app
// (validateCoupon). Admin-managed via service-role RPCs; no client write.
export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  code: text('code').notNull(),
  description: text('description'),
  createdReason: text('created_reason'), // internal "why issued" note (admin-only)
  discountType: text('discount_type').notNull(), // 'flat' | 'percentage'
  discountValue: numeric('discount_value', { precision: 10, scale: 2 }).notNull(),
  minimumOrderAmount: numeric('minimum_order_amount', { precision: 10, scale: 2 }),
  maxUses: integer('max_uses'), // null = unlimited
  currentUses: integer('current_uses').notNull().default(0),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One redemption per order (unique order_id) — consumed only on payment success
// inside process_razorpay_event (0017).
export const couponRedemptions = pgTable('coupon_redemptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  couponId: uuid('coupon_id')
    .notNull()
    .references(() => coupons.id),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id),
  amountDiscounted: numeric('amount_discounted', { precision: 10, scale: 2 }).notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Internal admin note timeline per order (0016). Append-only.
export const orderNotes = pgTable('order_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => profiles.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Transactional email delivery audit + idempotency (0022). Service-only writes;
// admins read. Never stores the email body.
export const emailLog = pgTable('email_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  eventType: text('event_type').notNull(),
  recipient: text('recipient').notNull(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  providerMessageId: text('provider_message_id'),
  status: text('status').notNull(), // 'sending' | 'sent' | 'failed' | 'skipped'
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only audit trail (0016). Written only by SECURITY DEFINER functions;
// admins read only. Order-related events embed {order_id, album_id, customer_id}.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  actorId: uuid('actor_id').references(() => profiles.id), // null = system
  actorType: text('actor_type').notNull(), // 'admin' | 'system' | 'customer'
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(), // 'order' | 'coupon'
  entityId: uuid('entity_id').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
