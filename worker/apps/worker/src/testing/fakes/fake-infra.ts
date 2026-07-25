import type {
  ObjectMetadata,
  ObjectStore,
  ObjectStoreHealth,
  WriteOptions,
} from '../../infra/storage/object-store.js';
import type {
  DatabaseAdapter,
  DatabaseHealth,
  DatabaseTransaction,
} from '../../infra/database/database-adapter.js';
import type {
  PageRenderer,
  RenderRequest,
  RenderResult,
} from '../../processors/pdf/page-renderer.js';

/**
 * IN-MEMORY INFRASTRUCTURE — working implementations of the three I-0 adapter ports plus the PDF
 * renderer port, for load, chaos and multi-worker validation without Postgres, R2 or Chromium.
 *
 * These are FAKES, not mocks: they actually store bytes, actually return what was written, and
 * actually count operations. That matters, because the properties under test (no lost jobs, no
 * duplicate writes, cleanup really removed the objects) are only meaningful against something with
 * real state. A mock that records calls would let a broken pipeline pass.
 */

/** An object store backed by a Map, with operation counters and a byte-size accounting. */
export class FakeObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly deletes: string[] = [];

  /** Seed an object (the raw upload an image job expects to find). */
  put(key: string, bytes: Uint8Array): void {
    this.objects.set(key, { bytes });
  }

  async read(key: string): Promise<Uint8Array | null> {
    this.reads.push(key);
    return this.objects.get(key)?.bytes ?? null;
  }

  async write(key: string, data: Uint8Array, options?: WriteOptions): Promise<ObjectMetadata> {
    this.writes.push(key);
    this.objects.set(key, {
      bytes: data,
      ...(options?.contentType === undefined ? {} : { contentType: options.contentType }),
    });
    return { key, sizeBytes: data.byteLength };
  }

  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.objects.delete(key); // idempotent, like R2
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : { key, sizeBytes: object.bytes.byteLength };
  }

  async healthCheck(): Promise<ObjectStoreHealth> {
    return 'healthy';
  }

  /** Live object count — the leak assertion for cleanup validation. */
  get size(): number {
    return this.objects.size;
  }

  /** Total bytes retained — the memory-growth assertion for long-running validation. */
  get bytesRetained(): number {
    let total = 0;
    for (const object of this.objects.values()) total += object.bytes.byteLength;
    return total;
  }

  get keys(): readonly string[] {
    return [...this.objects.keys()].sort();
  }
}

/**
 * A database adapter over an injectable row source. It records every statement so tests can assert
 * query COUNTS — which is how "recovery does not full-scan" and "health checks do not hammer the
 * database" become mechanical assertions rather than claims.
 */
export class FakeDatabase implements DatabaseAdapter {
  readonly statements: { text: string; params: readonly unknown[] }[] = [];
  connected = false;
  closed = false;
  /** Rows returned for a statement matching a substring. First match wins. */
  private readonly responders: {
    match: string;
    rows: (params: readonly unknown[]) => unknown[];
  }[] = [];

  /** Register canned rows for statements containing `match`. */
  on(match: string, rows: unknown[] | ((params: readonly unknown[]) => unknown[])): this {
    this.responders.push({ match, rows: typeof rows === 'function' ? rows : () => rows });
    return this;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query<T = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<readonly T[]> {
    this.statements.push({ text, params });
    const responder = this.responders.find((r) => text.includes(r.match));
    return (responder?.rows(params) ?? []) as T[];
  }

  async transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return fn({ query: (text, params) => this.query(text, params) });
  }

  async healthCheck(): Promise<DatabaseHealth> {
    return 'healthy';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
  }

  /** Statements whose text contains `match` — the query-count assertion. */
  countMatching(match: string): number {
    return this.statements.filter((s) => s.text.includes(match)).length;
  }
}

/**
 * A page renderer that returns bytes without a browser, and MODELS THE RESOURCE LIFECYCLE that makes
 * Chromium interesting: it tracks pages opened and closed, so "no page leaks" is directly assertable.
 * A renderer that leaked a page per render would fail `openPages === 0` after a load run.
 */
export class FakeRenderer implements PageRenderer {
  readonly calls: RenderRequest[] = [];
  private pagesOpen = 0;
  private peakPages = 0;
  /** Bytes returned per render; the default is a minimal valid-looking PDF header. */
  pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  /** Artificial render duration (ms) — models a slow PDF without a real browser. */
  durationMs = 0;

  async render(request: RenderRequest): Promise<RenderResult> {
    this.calls.push(request);
    this.pagesOpen += 1;
    this.peakPages = Math.max(this.peakPages, this.pagesOpen);
    try {
      if (this.durationMs > 0) await sleep(this.durationMs);
      return { pdf: this.pdf, httpStatus: 200 };
    } finally {
      this.pagesOpen -= 1; // a real renderer closes the page in its own `finally`
    }
  }

  /** Pages currently open — must return to 0 after any workload (the page-leak assertion). */
  get openPages(): number {
    return this.pagesOpen;
  }

  /** Highest simultaneous page count — proves PDF concurrency was actually bounded. */
  get peakOpenPages(): number {
    return this.peakPages;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
