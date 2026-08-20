import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import type { Job } from '../src/job.js';
import type { ObjectStore, ObjectMetadata, WriteOptions } from '../src/infra/storage/object-store.js';
import { PdfProcessor, ALBUM_PDF_TYPE } from '../src/processors/pdf/pdf-processor.js';
import type { PageRenderer, RenderRequest, RenderResult } from '../src/processors/pdf/page-renderer.js';
import type { AlbumOwner, AlbumPdfStore, PdfState } from '../src/processors/pdf/album-pdf-repository.js';
import type { PdfFailureCode, PdfStage } from '../src/processors/pdf/pdf-contract.js';
import { hashToken, previewPdfKey } from '../src/processors/pdf/pdf-contract.js';

/**
 * PDF GENERATION ↔ ALBUM DELETION RACE (Phase 6 Prompt 10).
 *
 * The pipeline uploads the PDF to R2 (UploadStage) and only THEN points the DB row at it
 * (FinalizeStage). Between those two steps the album can be deleted, and `album_pdfs` cascades
 * away with it — taking the only record of the R2 key. This suite reproduces that window
 * deterministically with a latch, and pins the required post-fix behaviour.
 *
 * THE FAKE MODELS THE REAL SQL. `markReady` is `update album_pdfs … where album_id = $1`: when the
 * row is gone the statement matches ZERO rows and raises NO error. `deleteAlbum()` here flips
 * `rowExists` to false and drops the owner, exactly as the CASCADE does.
 */

class RaceObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  readonly deletes: string[] = [];
  /** Fires immediately AFTER a successful write — the T4→T5 window. */
  onAfterWrite: (() => void | Promise<void>) | null = null;

  async read(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async write(key: string, data: Uint8Array, _o?: WriteOptions): Promise<ObjectMetadata> {
    this.objects.set(key, data);
    this.writes.push(key);
    if (this.onAfterWrite) await this.onAfterWrite();
    return { key, sizeBytes: data.byteLength };
  }
  /** Real R2 DeleteObject semantics: idempotent, a missing key is not an error. */
  async delete(key: string): Promise<void> {
    this.deletes.push(key);
    this.objects.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async head(): Promise<ObjectMetadata | null> {
    return null;
  }
  async healthCheck(): Promise<'healthy'> {
    return 'healthy';
  }
}

class RacePdfStore implements AlbumPdfStore {
  owner: AlbumOwner | null = { userId: 'u1' };
  state: PdfState | null = null;
  /** Whether the `album_pdfs` row still exists (CASCADE removes it with the album). */
  rowExists = true;
  ready: { albumId: string; r2Key: string } | null = null;
  failed: { albumId: string; message: string; code: PdfFailureCode } | null = null;
  readonly stages: PdfStage[] = [];

  /** Simulate `deleteAlbum` + the ON DELETE CASCADE that removes the album_pdfs row. */
  deleteAlbum(): void {
    this.owner = null;
    this.state = null;
    this.rowExists = false;
  }

  async findAlbumOwner(): Promise<AlbumOwner | null> {
    return this.owner;
  }
  async findPdfState(): Promise<PdfState | null> {
    return this.state;
  }
  async setStage(_albumId: string, stage: PdfStage): Promise<void> {
    if (!this.rowExists) return; // `where … and status='generating'` matches nothing
    this.stages.push(stage);
  }
  async markReady(albumId: string, r2Key: string): Promise<boolean> {
    if (!this.rowExists) return false; // UPDATE affected 0 rows — no error raised
    this.ready = { albumId, r2Key };
    return true;
  }
  async markFailed(albumId: string, message: string, code: PdfFailureCode): Promise<void> {
    if (!this.rowExists) return;
    this.failed = { albumId, message, code };
  }
  async findStaleGenerating(): Promise<readonly { albumId: string; attempts: number }[]> {
    return [];
  }
  async redrive(): Promise<void> {}
}

class RaceRenderer implements PageRenderer {
  /** Fires while rendering — the T1→T2 window. */
  onRender: (() => void | Promise<void>) | null = null;
  async render(_request: RenderRequest): Promise<RenderResult> {
    if (this.onRender) await this.onRender();
    return { pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]), httpStatus: 200 };
  }
}

const TOKEN = 'tok-race';
const ALBUM = 'a1';
const USER = 'u1';
const KEY = previewPdfKey(USER, ALBUM);
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function job(): Job<{ albumId: string; token: string }> {
  return {
    id: 'job-race',
    type: ALBUM_PDF_TYPE,
    payload: { albumId: ALBUM, token: TOKEN },
    metadata: { correlationId: 'req-race', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function build() {
  const store = new RaceObjectStore();
  const pdf = new RacePdfStore();
  const renderer = new RaceRenderer();
  const logger = new RecordingLogger();
  pdf.state = { status: 'generating', tokenHash: hashToken(TOKEN), tokenExpiresAt: FUTURE };
  const processor = new PdfProcessor({
    pdf,
    objectStore: store,
    renderer,
    appUrl: 'https://app.example.com',
    logger,
  });
  return { processor, store, pdf, renderer, logger };
}

/** THE INVARIANT: no R2 object may survive without a DB row that names it. */
function assertNoOwnerlessObject(store: RaceObjectStore, pdf: RacePdfStore): void {
  const objectExists = store.objects.has(KEY);
  const dbOwns = pdf.rowExists && pdf.ready?.r2Key === KEY;
  expect(
    objectExists && !dbOwns,
    `ownerless R2 object: exists=${objectExists} dbOwns=${dbOwns}`,
  ).toBe(false);
}

describe('preview-PDF key contract', () => {
  /**
   * The app reconstructs this exact key when deleting an album whose render may have crashed
   * mid-flight (src/lib/pdf/key.ts). Pinning the literal here means a change to the renderer's
   * format fails loudly instead of silently stranding objects the app can no longer name.
   */
  it('is the deterministic {userId}/albums/{albumId}/preview.pdf', () => {
    expect(previewPdfKey('u1', 'a1')).toBe('u1/albums/a1/preview.pdf');
  });
});

describe('PDF ↔ album-deletion race', () => {
  it('A. delete BEFORE the job starts → validate refuses, nothing is ever uploaded', async () => {
    const { processor, store, pdf } = build();
    pdf.deleteAlbum(); // album already gone when the job is picked up

    await processor.process(job());

    expect(store.writes, 'no render output may reach R2 for a deleted album').toEqual([]);
    expect(pdf.ready).toBeNull();
    assertNoOwnerlessObject(store, pdf);
  });

  it('B. delete DURING render → the uploaded object must not be left ownerless', async () => {
    const { processor, store, pdf, renderer } = build();
    renderer.onRender = () => pdf.deleteAlbum();

    await processor.process(job());

    expect(pdf.ready, 'must not record readiness for a deleted album').toBeNull();
    assertNoOwnerlessObject(store, pdf);
  });

  it('C. delete IMMEDIATELY AFTER the R2 upload (the T4→T5 window) → object is compensated', async () => {
    const { processor, store, pdf } = build();
    // The exact reported sequence: bytes land in R2, THEN the album disappears, THEN finalize runs.
    store.onAfterWrite = () => pdf.deleteAlbum();

    await processor.process(job());

    expect(store.writes, 'the upload did happen').toContain(KEY);
    expect(pdf.ready, 'finalize must not claim success against a vanished row').toBeNull();
    expect(store.deletes, 'the orphan must be handed to cleanup').toContain(KEY);
    assertNoOwnerlessObject(store, pdf);
  });

  it('C2. the job must NOT report a ready outcome when the row vanished', async () => {
    const { processor, store, pdf, logger } = build();
    store.onAfterWrite = () => pdf.deleteAlbum();

    await processor.process(job());

    const events = logger.records.map((r) => JSON.stringify(r));
    const claimedReady = events.some((e) => /"outcome":"ready"/.test(e));
    expect(claimedReady, 'a vanished row must never be reported as a ready PDF').toBe(false);
  });

  it('D. delete AFTER the PDF is ready → the row owned the key while it existed', async () => {
    const { processor, store, pdf } = build();

    await processor.process(job());

    // Normal success first: the DB row names the object, so deleteAlbum can collect the key.
    expect(pdf.ready).toEqual({ albumId: ALBUM, r2Key: KEY });
    expect(store.objects.has(KEY)).toBe(true);

    // Deletion now happens with r2_key populated — the app enqueues that exact key for cleanup.
    const collectedKey = pdf.ready?.r2Key;
    pdf.deleteAlbum();
    expect(collectedKey, 'deleteAlbum can derive the key from the row it just read').toBe(KEY);
    await store.delete(collectedKey!);
    expect(store.objects.has(KEY)).toBe(false);
  });

  it('E. retry after deletion → still no ownerless object, still no false success', async () => {
    const { processor, store, pdf } = build();
    store.onAfterWrite = () => pdf.deleteAlbum();
    await processor.process(job());

    // pg-boss redelivery / recovery re-drive of the same deterministic key.
    await processor.process(job());

    expect(pdf.ready).toBeNull();
    assertNoOwnerlessObject(store, pdf);
  });

  it('normal generation is unaffected: upload, finalize, no compensating delete', async () => {
    const { processor, store, pdf } = build();

    await processor.process(job());

    expect(store.writes).toEqual([KEY]);
    expect(pdf.ready).toEqual({ albumId: ALBUM, r2Key: KEY });
    expect(store.deletes, 'a healthy run must never delete its own PDF').toEqual([]);
    assertNoOwnerlessObject(store, pdf);
  });
});
