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

export const CreateAlbumSchema = z.object({
  title: z
    .string()
    .min(1, 'Album title is required')
    .max(100, 'Title must be 100 characters or less'),
  productId: z.string().uuid('Please select an album size'),
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

export const EditConfigSchema = z.object({
  crop: RectSchema.optional(),
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
  template: z.enum(['single-full', 'spread-full']),
  photoIds: z.array(z.string().uuid()).max(1), // base slot only
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

// ── Addresses & checkout ─────────────────────────────────────────────────────

export const AddressSchema = z.object({
  fullName: z.string().min(2, 'Full name is required').max(100),
  line1: z.string().min(1, 'Address is required').max(200),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional().default(false),
});

// Checkout inputs carry NO amount — the total is always computed server-side from
// the album's product. Only references cross the wire.
export const CreateOrderSchema = z.object({
  albumId: z.string().uuid('Invalid album'),
  addressId: z.string().uuid('Please select a delivery address'),
});

export const CancelOrderSchema = z.object({
  orderId: z.string().uuid('Invalid order'),
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
