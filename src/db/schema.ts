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

// ── Album Product catalog (0047) ─────────────────────────────────────────────
// Physical album products (Standard / Premium / Signature). The single source of truth
// for dimensions/aspect/print-size (the builder + print route + worker read these — never
// hardcoded). Public-read active rows; service-role writes (mirrors cover_templates/stickers).
export const albumProducts = pgTable('album_products', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  widthCm: numeric('width_cm', { precision: 6, scale: 2 }).notNull(),
  heightCm: numeric('height_cm', { precision: 6, scale: 2 }).notNull(),
  builderAspectRatio: numeric('builder_aspect_ratio', { precision: 8, scale: 5 }).notNull(),
  printWidthCm: numeric('print_width_cm', { precision: 6, scale: 2 }).notNull(),
  printHeightCm: numeric('print_height_cm', { precision: 6, scale: 2 }).notNull(),
  coverPreviewKey: text('cover_preview_key'),
  // Demo album for the interactive Flipbook preview (0048). Null → gallery-image preview.
  demoAlbumId: uuid('demo_album_id'),
  // Marketing tags for the preview info panel (0048), e.g. {Travel,Wedding,Family}.
  bestFor: text('best_for').array().notNull().default(sql`'{}'::text[]`),
  displayOrder: integer('display_order').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// Ordered gallery of preview images per product (R2 keys; presigned GET like photos/covers).
export const albumProductPreviews = pgTable('album_product_previews', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  productId: uuid('product_id')
    .notNull()
    .references(() => albumProducts.id, { onDelete: 'cascade' }),
  imageKey: text('image_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Price per (product, page_count). Pricing now varies by PRODUCT + page count, not page count alone.
export const albumProductPrices = pgTable('album_product_prices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  productId: uuid('product_id')
    .notNull()
    .references(() => albumProducts.id, { onDelete: 'cascade' }),
  pageCount: integer('page_count').notNull(),
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const albums = pgTable('albums', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  size: integer('size').notNull(),
  // Chosen physical product (0047). Nullable only for pre-migration rows; backfilled to Standard.
  // Page count remains `size`; product_id carries dimensions/pricing identity.
  productId: uuid('product_id').references(() => albumProducts.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('draft'),
  // Optional customer-authored metadata (0026). Free text; authored at creation,
  // editable later. Never gates anything — display only.
  destination: text('destination'),
  travelDates: text('travel_dates'),
  description: text('description'),
  // Product snapshot at creation (0049) — historical record; rendering still uses live product
  // dimensions (0047). All nullable (pre-migration albums stay null).
  productName: text('product_name'),
  productWidthCm: numeric('product_width_cm', { precision: 6, scale: 2 }),
  productHeightCm: numeric('product_height_cm', { precision: 6, scale: 2 }),
  productAspectRatio: numeric('product_aspect_ratio', { precision: 8, scale: 5 }),
  productPrintWidthCm: numeric('product_print_width_cm', { precision: 6, scale: 2 }),
  productPrintHeightCm: numeric('product_print_height_cm', { precision: 6, scale: 2 }),
  // Selected cover design (admin-managed template). Null until chosen; required to
  // submit / generate the PDF. ON DELETE SET NULL handled in 0023.
  coverTemplateId: uuid('cover_template_id'),
  // When set, this is a short-lived admin DRAFT album used to edit a blueprint in the builder
  // (0046). Hidden from the customer dashboard; deleted when the blueprint is saved.
  blueprintDraftOf: uuid('blueprint_draft_of'),
  // Custom cover DESIGN (0038): subtitle, typography, layout, position, background,
  // optional photo source. The cover title is `title`. Null = plain template cover.
  coverConfig: jsonb('cover_config'),
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

// Admin-managed sticker catalog (0039). Decorative artwork for the cover + pages. Artwork bytes
// live in private R2 under stickers/…; only metadata + keys here. Customers SELECT active rows;
// admins write via service-role. Mirrors cover_templates.
export const stickerCategories = pgTable('sticker_categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stickers = pgTable('stickers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  categoryId: uuid('category_id').references(() => stickerCategories.id, { onDelete: 'set null' }),
  imageKey: text('image_key').notNull(),
  thumbKey: text('thumb_key'),
  width: integer('width'),
  height: integer('height'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  // Searchable keyword labels (0042). Additive; defaults to '{}'.
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
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
  // Product snapshot at purchase time (0047) — historical accuracy independent of later
  // catalog edits. product_id is a soft ref (SET NULL on product delete); name/dimensions
  // are frozen copies.
  productId: uuid('product_id').references(() => albumProducts.id, { onDelete: 'set null' }),
  productName: text('product_name'),
  productDimensions: jsonb('product_dimensions'),
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

// ── Support Center (0028) ─────────────────────────────────────────────────────

// Customer ↔ admin support tickets. Customer-owned (RLS customer_id = auth.uid());
// admins read all + mutate via SECURITY DEFINER RPCs. Linked album/order are
// nullable + ON DELETE SET NULL (no ownership coupling into payments/uploads).
export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  albumId: uuid('album_id').references(() => albums.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  category: text('category').notNull().default('other'),
  priority: text('priority').notNull().default('medium'),
  status: text('status').notNull().default('open'),
  subject: text('subject').notNull(),
  description: text('description').notNull(),
  assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// Ticket conversation timeline. Internal notes (is_internal) are admin-only (RLS).
// Inserts fire a trigger that bumps the parent ticket + writes the audit row.
export const supportMessages = pgTable('support_messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ticketId: uuid('ticket_id')
    .notNull()
    .references(() => supportTickets.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'customer' | 'admin'
  senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'set null' }),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Refund & Reprint Management (0029) ────────────────────────────────────────

// Customer-raised refund requests. RECORDS DECISIONS ONLY — never triggers a Razorpay
// refund or touches orders/payments. Customer-owned (RLS); admins decide via RPCs.
// admin_notes / resolved_by are server-only (hidden from authenticated by column grants).
export const refundRequests = pgTable('refund_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  supportTicketId: uuid('support_ticket_id').references(() => supportTickets.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// Customer-raised reprint requests (a fresh print of a delivered album). Same model
// as refunds; never touches the PDF / print pipeline automatically — admins decide.
export const reprintRequests = pgTable('reprint_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  supportTicketId: uuid('support_ticket_id').references(() => supportTickets.id, { onDelete: 'set null' }),
  issueType: text('issue_type').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// ── Album Review & Request-Changes (0030) ────────────────────────────────────

// Parallel, advisory review of a submitted album BEFORE checkout. One row per album
// (unique album_id). Customer-owned (RLS customer_id = auth.uid()); admins decide via
// SECURITY DEFINER RPCs. review_notes is the customer-visible decision message;
// reviewed_by is internal (hidden from authenticated by column-scoped grant). NEVER
// touches orders/payments/PDF/fulfilment — records the review decision only.
export const albumReviews = pgTable('album_reviews', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  albumId: uuid('album_id')
    .notNull()
    .references(() => albums.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending_review'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// One row per "request changes" loop. requested_changes is customer-visible. The
// lifecycle (open → in_progress → resubmitted → completed) is driven by the definer
// RPCs; a partial unique index allows only one active revision per review.
export const revisionRequests = pgTable('revision_requests', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  albumReviewId: uuid('album_review_id')
    .notNull()
    .references(() => albumReviews.id, { onDelete: 'cascade' }),
  albumId: uuid('album_id')
    .notNull()
    .references(() => albums.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  requestedChanges: text('requested_changes').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ── CMS & Content Management (0031) ───────────────────────────────────────────

// Admin-owned content (FAQs, testimonials, legacy stories, homepage sections, blog,
// announcements). One polymorphic table; per-type extras live in `metadata`. Public-read
// model (anon/authenticated SELECT published rows; admins write via service role). Never
// coupled to customer albums/orders — pure marketing/help content.
export const contentPages = pgTable('content_pages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: text('type').notNull(),
  status: text('status').notNull().default('draft'),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  excerpt: text('excerpt'),
  content: text('content'),
  coverImage: text('cover_image'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// ── Template Management (0032) ────────────────────────────────────────────────

// Admin-owned catalog of curated layout PRESETS. `geometry` maps onto the existing two
// renderer primitives ({ base: 'single-pair'|'double-spread', overlays: Rect[] }); applying
// one produces an ordinary Block[]. Active-read model (authenticated SELECT active rows;
// admins write via service role). Never reaches the renderer/saveLayout beyond the existing
// Block shape — PDF parity by construction.
export const layoutTemplates = pgTable('layout_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  status: text('status').notNull().default('inactive'),
  geometry: jsonb('geometry').notNull(),
  previewImage: text('preview_image'),
  // Album Blueprint (0043) — when non-null this row is a whole-album blueprint ({version, blocks}),
  // not a single-spread preset. page_count/slot_count/recommended_photos are DERIVED on write.
  blueprint: jsonb('blueprint'),
  pageCount: integer('page_count'),
  slotCount: integer('slot_count'),
  recommendedPhotos: integer('recommended_photos'),
  featured: boolean('featured').notNull().default(false),
  popular: boolean('popular').notNull().default(false),
  pinned: boolean('pinned').notNull().default(false),
  // Default blueprint per album size (0045) — at most one per page_count; used by Auto Create.
  isDefault: boolean('is_default').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  thumbKey: text('thumb_key'),
  // Blueprint preview render token (0044) — short-lived gate for the worker's screenshot route.
  previewTokenHash: text('preview_token_hash'),
  previewTokenExpiresAt: timestamp('preview_token_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// Admin-designed cover TEMPLATES (0040). Unlike cover_templates (0023 = an uploaded PNG used as a
// backdrop image), a row here stores a full CoverConfig snapshot (lib/builder/cover.ts) built in the
// SAME cover editor customers use. Applying one deep-copies its config into albums.cover_config
// (photoIds nulled), fully editable thereafter. Active-read model (authenticated SELECT active rows;
// admins write via service role). Renders through the existing CoverConfig path — PDF parity by construction.
export const coverDesignTemplates = pgTable('cover_design_templates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  category: text('category').notNull().default('general'),
  status: text('status').notNull().default('inactive'),
  config: jsonb('config').notNull(),
  previewKey: text('preview_key'),
  thumbKey: text('thumb_key'),
  featured: boolean('featured').notNull().default(false),
  // Merchandising flags (0041) — surface "Popular" + sticky "Pinned" shelves in the picker.
  popular: boolean('popular').notNull().default(false),
  pinned: boolean('pinned').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Courier & Shipping (0033) ─────────────────────────────────────────────────

// Supplemental shipment layer — INDEPENDENT of orders.status (never writes it). Structured
// courier metadata + a courier-abstraction seam. Child-of-order ownership RLS (customers read
// shipments for their own orders; admins write via service role). One shipment per order.
export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  courier: text('courier').notNull(),
  trackingNumber: text('tracking_number'),
  shipmentStatus: text('shipment_status').notNull().default('created'),
  labelUrl: text('label_url'),
  externalReference: text('external_reference'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
});

// Append-only shipment timeline (courier events). Service-role insert only.
export const shipmentEvents = pgTable('shipment_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  shipmentId: uuid('shipment_id')
    .notNull()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  description: text('description'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Multi-Role RBAC (0034) ────────────────────────────────────────────────────

// Maps an existing admin (profiles.role='admin') to ONE fixed back-office role. Absent row
// → treated as super_admin in the app (migration safety). Service-role writes only.
export const adminRoles = pgTable('admin_roles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  assignedBy: uuid('assigned_by').references(() => profiles.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Monitoring & Alerting (0035) ──────────────────────────────────────────────

// Per-service health snapshots (append-only history) + append-only alerts. Admin-only;
// written only by the monitoring engine (service role). Read-only over existing tables.
export const healthChecks = pgTable('health_checks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  service: text('service').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});

export const systemAlerts = pgTable('system_alerts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  severity: text('severity').notNull(),
  source: text('source').notNull(),
  title: text('title').notNull(),
  message: text('message'),
  dedupeKey: text('dedupe_key').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
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

// ── Error Tracking & Observability (0036) ─────────────────────────────────────

// Append-only store of captured failures/exceptions/slow ops across app + worker. Written
// ONLY via the record_error_event() RPC (service role); admins read only (RBAC observability:*).
// Deduped by fingerprint (one open row per condition, occurrences++). Reuses system_alerts (0035)
// for critical-error alerting.
export const errorEvents = pgTable('error_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  severity: text('severity').notNull(), // 'info' | 'warning' | 'error' | 'critical'
  source: text('source').notNull(),
  category: text('category').notNull(), // api|payment|upload|pdf|email|auth|support|shipping|system
  message: text('message').notNull(),
  stack: text('stack'),
  requestId: text('request_id'),
  userId: uuid('user_id').references(() => profiles.id),
  metadata: jsonb('metadata'),
  fingerprint: text('fingerprint').notNull(),
  resolved: boolean('resolved').notNull().default(false),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => profiles.id),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  occurrences: integer('occurrences').notNull().default(1),
});
