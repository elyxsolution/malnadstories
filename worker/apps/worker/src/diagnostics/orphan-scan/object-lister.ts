/**
 * READ-ONLY R2 ACCESS — the only storage surface the DETECTOR has.
 *
 * WHY THIS EXISTS INSTEAD OF REUSING `ObjectStore`. The worker's existing `ObjectStore`
 * (`infra/storage/object-store.ts`) is a read/WRITE/DELETE abstraction: it exposes `write()` and
 * `delete()`, and its R2 implementation imports `PutObjectCommand` and `DeleteObjectCommand`. A
 * detector that held one of those would be a single mistaken call away from destroying a
 * photograph. So the detector gets its own port whose entire surface is READ — `listPage` and
 * `headObject`. There is no write method and no delete method to call, in either interface or in
 * the implementation.
 *
 * The import list below is the enforcement: only `S3Client`, `ListObjectsV2Command` and
 * `HeadObjectCommand` are imported into this file. `DeleteObjectCommand` /
 * `DeleteObjectsCommand` / `PutObjectCommand` are absent, so no destructive operation is even
 * reachable from here. Phase 6 Prompt 3's deletion capability lives in a SEPARATE module
 * (`orphan-cleanup/deleter.ts`) behind a branded proof type — deliberately not here.
 */

import { HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { ListedObject } from './classify.js';

/** One page of a listing. */
export interface ListPage {
  readonly objects: readonly ListedObject[];
  /** Opaque cursor for the next page, or `null` when the listing is exhausted. */
  readonly nextToken: string | null;
}

export interface ListPageRequest {
  readonly prefix: string;
  readonly continuationToken: string | null;
  readonly maxKeys: number;
}

/**
 * The storage seam the scanner depends on. READ-ONLY BY CONSTRUCTION — one method, which lists.
 * Fakes in tests implement this trivially; the production implementation is below.
 */
export interface ReadOnlyObjectLister {
  listPage(request: ListPageRequest): Promise<ListPage>;
}

/**
 * A single object's CURRENT metadata, read fresh. Phase 6 Prompt 3 uses this to prove that the
 * object it is about to delete is byte-for-byte the same object the scan classified.
 *
 * Deliberately a SEPARATE interface from `ReadOnlyObjectLister` so the Prompt-2 scanner (and its
 * test fakes) are unaffected: listing does not require the ability to head, and nothing that only
 * lists gains a new capability.
 */
export interface ReadOnlyMetadataReader {
  /** Fresh metadata for one key, or `null` when the object does not exist. */
  headObject(key: string): Promise<ListedObject | null>;
}

/** The minimal S3 surface used here (injectable/fakeable, mirroring `R2ObjectStore`'s `S3Like`). */
export interface S3ListLike {
  send(command: unknown): Promise<unknown>;
}

/** Shape of the `ListObjectsV2` response fields this reads. */
interface ListObjectsV2Result {
  readonly Contents?: readonly {
    readonly Key?: string;
    readonly Size?: number;
    readonly LastModified?: Date;
    readonly ETag?: string;
  }[];
  readonly IsTruncated?: boolean;
  readonly NextContinuationToken?: string;
}

/** Credentials come from the environment via config — never from a caller or a CLI argument. */
export interface ListerConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/** Shape of the `HeadObject` response fields this reads. */
interface HeadObjectResult {
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly ETag?: string;
}

export class R2ReadOnlyLister implements ReadOnlyObjectLister, ReadOnlyMetadataReader {
  constructor(
    private readonly client: S3ListLike,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: ListerConfig): R2ReadOnlyLister {
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    return new R2ReadOnlyLister(client as unknown as S3ListLike, config.bucket);
  }

  /**
   * One `ListObjectsV2` call. Pagination is the CALLER's loop (see `scan.ts`) so that a failure
   * mid-listing is visible as a partial scan rather than being retried invisibly inside here.
   *
   * `IsTruncated` alone is not trusted: a next token is only reported when the backend actually
   * supplies one, so a truncated response without a token ends the loop rather than spinning.
   */
  async listPage(request: ListPageRequest): Promise<ListPage> {
    const out = (await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        ...(request.prefix === '' ? {} : { Prefix: request.prefix }),
        MaxKeys: request.maxKeys,
        ...(request.continuationToken === null
          ? {}
          : { ContinuationToken: request.continuationToken }),
      }),
    )) as ListObjectsV2Result;

    const objects: ListedObject[] = [];
    for (const item of out.Contents ?? []) {
      if (typeof item.Key !== 'string' || item.Key.length === 0) continue;
      objects.push({
        key: item.Key,
        sizeBytes: typeof item.Size === 'number' ? item.Size : null,
        // A missing or unparseable LastModified stays null — the classifier protects on it.
        lastModified:
          item.LastModified instanceof Date && Number.isFinite(item.LastModified.getTime())
            ? item.LastModified.toISOString()
            : null,
        etag: typeof item.ETag === 'string' ? item.ETag : null,
      });
    }

    const truncated = out.IsTruncated === true;
    const token =
      truncated &&
      typeof out.NextContinuationToken === 'string' &&
      out.NextContinuationToken.length > 0
        ? out.NextContinuationToken
        : null;

    return { objects, nextToken: token };
  }

  /**
   * Fresh metadata for one exact key. `null` means the object is genuinely absent (404/NoSuchKey);
   * every other failure THROWS, because "I could not reach R2" must never be mistaken for
   * "the object is gone" by a caller that is about to decide whether to delete something.
   */
  async headObject(key: string): Promise<ListedObject | null> {
    try {
      const out = (await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as HeadObjectResult;
      return {
        key,
        sizeBytes: typeof out.ContentLength === 'number' ? out.ContentLength : null,
        lastModified:
          out.LastModified instanceof Date && Number.isFinite(out.LastModified.getTime())
            ? out.LastModified.toISOString()
            : null,
        etag: typeof out.ETag === 'string' ? out.ETag : null,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

/** Recognise an "object does not exist" outcome, as distinct from a transport failure. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (e.name === 'NoSuchKey' || e.name === 'NotFound') return true;
  return e.$metadata?.httpStatusCode === 404;
}
