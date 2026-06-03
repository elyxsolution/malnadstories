import 'server-only';

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Cloudflare R2 access — server-only.
 *
 * R2 is S3-compatible, so we use @aws-sdk/client-s3 pointed at the account-level
 * R2 endpoint. Credentials are read ONLY here, from env, and never leave the server.
 * The bucket is PRIVATE: every read is a short-lived presigned GET, never a public URL.
 *
 * The `import 'server-only'` above makes the build fail if this module is ever
 * pulled into a Client Component bundle.
 */

const BUCKET = process.env.R2_BUCKET_NAME!;

// Allowed MIME types and their canonical file extensions. Used both for validation
// and for choosing the object-key extension. Keep in sync with PresignUploadSchema.
export const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
} as const;

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

let client: S3Client | null = null;

function r2(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

/**
 * Presigned PUT URL for a direct browser → R2 upload.
 *
 * The signature PINS both Content-Type and the EXACT Content-Length declared by
 * the client. The browser sends the file's real size as Content-Length and the
 * Content-Type header we tell it to; if the client tries to upload a different
 * type or a different number of bytes than it declared, the signature won't match
 * and R2 rejects the request. The file bytes never pass through our server.
 */
export async function presignPut(params: {
  key: string;
  contentType: AllowedContentType;
  contentLength: number;
  expiresIn?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });

  return getSignedUrl(r2(), command, {
    expiresIn: params.expiresIn ?? 300, // 5 minutes
    signableHeaders: new Set(['content-type', 'content-length']),
  });
}

/**
 * Short-lived presigned GET URL for a private object. Pass `downloadFilename` to
 * force a browser download (Content-Disposition: attachment) — used for the PDF.
 */
export async function presignGet(
  key: string,
  expiresIn = 600,
  opts?: { downloadFilename?: string },
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(opts?.downloadFilename
      ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
      : {}),
  });
  return getSignedUrl(r2(), command, { expiresIn });
}

/**
 * Hard-delete an object from R2. Caller MUST have already verified ownership.
 */
export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
