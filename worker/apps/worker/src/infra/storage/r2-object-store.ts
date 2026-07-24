import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import type { StorageInfraConfig } from '../config.js';
import type {
  ObjectMetadata,
  ObjectStore,
  ObjectStoreHealth,
  WriteOptions,
} from './object-store.js';

/**
 * R2 OBJECT STORE — the production `ObjectStore` over Cloudflare R2 via the S3-compatible AWS SDK,
 * pointed at the account-level R2 endpoint. It mirrors the application's own R2 client config exactly
 * (endpoint/region/credentials/bucket from the shared env), so the worker reads and writes the SAME
 * private bucket, respecting the SAME key layout.
 *
 * The adapter depends on a minimal structural `S3Like` port (only `send`), so it is unit tested with a
 * fake — no network. `fromConfig` builds the real `S3Client`. This phase only PREPARES the adapter;
 * nothing reads or writes objects yet.
 */

/** The minimal S3 client surface this adapter uses (the injectable, fakeable seam). */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

/** Shape of a `GetObject` response body in the Node SDK (the SdkStream helper this adapter relies on). */
interface GetObjectResult {
  readonly Body?: { transformToByteArray(): Promise<Uint8Array> };
  readonly ContentType?: string;
  readonly ContentLength?: number;
  readonly ETag?: string;
  readonly LastModified?: Date;
}

interface HeadObjectResult {
  readonly ContentType?: string;
  readonly ContentLength?: number;
  readonly ETag?: string;
  readonly LastModified?: Date;
}

export class R2ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
  ) {}

  /** Build an R2 object store over a real `S3Client` from the storage config. */
  static fromConfig(config: StorageInfraConfig): R2ObjectStore {
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    return new R2ObjectStore(client as unknown as S3Like, config.bucket);
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const out = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as GetObjectResult;
      if (out.Body === undefined) return null;
      return await out.Body.transformToByteArray();
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(key: string, data: Uint8Array, options?: WriteOptions): Promise<ObjectMetadata> {
    const out = (await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ...(options?.contentType === undefined ? {} : { ContentType: options.contentType }),
      }),
    )) as { ETag?: string };
    return {
      key,
      sizeBytes: data.byteLength,
      ...(options?.contentType === undefined ? {} : { contentType: options.contentType }),
      ...(out.ETag === undefined ? {} : { etag: out.ETag }),
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const out = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as HeadObjectResult;
      return {
        key,
        sizeBytes: out.ContentLength ?? 0,
        ...(out.ContentType === undefined ? {} : { contentType: out.ContentType }),
        ...(out.ETag === undefined ? {} : { etag: out.ETag }),
        ...(out.LastModified === undefined ? {} : { lastModified: out.LastModified.toISOString() }),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async healthCheck(): Promise<ObjectStoreHealth> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }
}

/** Recognize an S3/R2 "object/bucket does not exist" outcome (vs a real transport error). */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (e.name === 'NoSuchKey' || e.name === 'NotFound') return true;
  return e.$metadata?.httpStatusCode === 404;
}
