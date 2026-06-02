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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  razorpayOrderId: text('razorpay_order_id'),
  placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
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
