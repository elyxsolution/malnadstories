import { describe, it, expect } from 'vitest';
import { RecordingLogger } from '@workerv2/worker-runtime';
import type { Job } from '../src/job.js';
import type {
  ObjectStore,
  ObjectMetadata,
  WriteOptions,
} from '../src/infra/storage/object-store.js';
import { PdfProcessor, ALBUM_PDF_TYPE } from '../src/processors/pdf/pdf-processor.js';
import {
  PrintRouteError,
  RendererCrashedError,
  type PageRenderer,
  type RenderRequest,
  type RenderResult,
} from '../src/processors/pdf/page-renderer.js';
import type {
  AlbumOwner,
  AlbumPdfStore,
  PdfState,
} from '../src/processors/pdf/album-pdf-repository.js';
import type { PdfFailureCode, PdfStage } from '../src/processors/pdf/pdf-contract.js';
import { hashToken } from '../src/processors/pdf/pdf-contract.js';

// --- Fakes ------------------------------------------------------------------------------------

class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly writes: string[] = [];
  failWrite = false;
  async read(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async write(key: string, data: Uint8Array, _o?: WriteOptions): Promise<ObjectMetadata> {
    if (this.failWrite) throw new Error('r2 down');
    this.objects.set(key, data);
    this.writes.push(key);
    return { key, sizeBytes: data.byteLength };
  }
  async delete(): Promise<void> {}
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

class FakePdfStore implements AlbumPdfStore {
  owner: AlbumOwner | null = { userId: 'u1' };
  state: PdfState | null = null;
  readonly stages: PdfStage[] = [];
  ready: { albumId: string; r2Key: string } | null = null;
  failed: { albumId: string; message: string; code: PdfFailureCode } | null = null;
  failMarkReady = false;

  async findAlbumOwner(): Promise<AlbumOwner | null> {
    return this.owner;
  }
  async findPdfState(): Promise<PdfState | null> {
    return this.state;
  }
  async setStage(_albumId: string, stage: PdfStage): Promise<void> {
    this.stages.push(stage);
  }
  async markReady(albumId: string, r2Key: string): Promise<void> {
    if (this.failMarkReady) throw new Error('db down');
    this.ready = { albumId, r2Key };
  }
  async markFailed(albumId: string, message: string, code: PdfFailureCode): Promise<void> {
    this.failed = { albumId, message, code };
  }
  async findStaleGenerating(): Promise<readonly { albumId: string; attempts: number }[]> {
    return [];
  }
  async redrive(): Promise<void> {}
}

class FakeRenderer implements PageRenderer {
  readonly calls: RenderRequest[] = [];
  mode: 'ok' | 'print-error' | 'crash' | 'empty' = 'ok';
  pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  async render(request: RenderRequest): Promise<RenderResult> {
    this.calls.push(request);
    if (this.mode === 'print-error') throw new PrintRouteError(500);
    if (this.mode === 'crash') throw new RendererCrashedError('Target closed');
    if (this.mode === 'empty') throw new Error('page.pdf produced 0 bytes');
    return { pdf: this.pdf, httpStatus: 200 };
  }
}

const TOKEN = 'tok-abc';
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function generatingState(token = TOKEN, expiresAt: string | null = FUTURE): PdfState {
  return { status: 'generating', tokenHash: hashToken(token), tokenExpiresAt: expiresAt };
}

function job(albumId = 'a1', token = TOKEN): Job<{ albumId: string; token: string }> {
  return {
    id: 'job-1',
    type: ALBUM_PDF_TYPE,
    payload: { albumId, token },
    metadata: { correlationId: 'req-1', attempt: 1 },
    enqueuedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
  };
}

function build(): {
  processor: PdfProcessor;
  store: FakeObjectStore;
  pdf: FakePdfStore;
  renderer: FakeRenderer;
  logger: RecordingLogger;
} {
  const store = new FakeObjectStore();
  const pdf = new FakePdfStore();
  const renderer = new FakeRenderer();
  const logger = new RecordingLogger();
  const processor = new PdfProcessor({
    pdf,
    objectStore: store,
    renderer,
    appUrl: 'https://app.example.com',
    logger,
  });
  return { processor, store, pdf, renderer, logger };
}

// --- Tests ------------------------------------------------------------------------------------

describe('pdf pipeline — happy path', () => {
  it('renders the print route, uploads, and finalizes album_pdfs → ready', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    await ctx.processor.process(job());

    // rendered the correct print URL (token in query only)
    expect(ctx.renderer.calls).toHaveLength(1);
    expect(ctx.renderer.calls[0]?.url).toBe('https://app.example.com/albums/a1/print?t=tok-abc');
    // uploaded under the deterministic preview key
    expect(ctx.store.writes).toEqual(['u1/albums/a1/preview.pdf']);
    // finalized
    expect(ctx.pdf.ready).toEqual({ albumId: 'a1', r2Key: 'u1/albums/a1/preview.pdf' });
    expect(ctx.pdf.failed).toBeNull();
    // progress advanced through the stages
    expect(ctx.pdf.stages).toEqual(['preparing', 'rendering', 'uploading', 'finalizing']);
  });
});

describe('pdf pipeline — skip (ack, no failure)', () => {
  it('skips when the token was superseded by a newer request', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState('a-different-token');
    await ctx.processor.process(job());
    expect(ctx.renderer.calls).toHaveLength(0);
    expect(ctx.pdf.failed).toBeNull();
    expect(ctx.logger.records.some((r) => r.message === 'pdf.superseded')).toBe(true);
  });

  it('skips when the album is already rendered (duplicate delivery)', async () => {
    const ctx = build();
    ctx.pdf.state = { status: 'ready', tokenHash: hashToken(TOKEN), tokenExpiresAt: FUTURE };
    await ctx.processor.process(job());
    expect(ctx.renderer.calls).toHaveLength(0);
    expect(ctx.pdf.failed).toBeNull();
  });
});

describe('pdf pipeline — permanent failures (marked failed with code)', () => {
  it('album missing → album_missing', async () => {
    const ctx = build();
    ctx.pdf.owner = null;
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('album_missing');
    expect(ctx.renderer.calls).toHaveLength(0);
  });

  it('expired token → token_expired', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState(TOKEN, new Date(Date.now() - 1000).toISOString());
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('token_expired');
  });

  it('print route non-OK → print_route_error', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'print-error';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('print_route_error');
    expect(ctx.store.writes).toEqual([]); // never uploaded
  });

  it('empty PDF → render_empty', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'empty';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('render_empty');
  });
});

describe('pdf pipeline — transient failures (marked failed with code; I-3 sweep will redrive)', () => {
  it('browser crash → render_engine_failed', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'crash';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('render_engine_failed');
  });

  it('upload failure → upload_failed', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.store.failWrite = true;
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('upload_failed');
  });

  it('finalize DB failure → db_update_failed', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.pdf.failMarkReady = true;
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('db_update_failed');
    // the PDF WAS uploaded before the DB write failed (retry re-uploads the same key — no duplicate)
    expect(ctx.store.writes).toEqual(['u1/albums/a1/preview.pdf']);
  });
});

describe('pdf pipeline — idempotency & guards', () => {
  it('re-running writes the SAME deterministic key (overwrite, no duplicate PDF)', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    await ctx.processor.process(job());
    ctx.pdf.state = generatingState(); // fresh generating row, same token (redelivery)
    await ctx.processor.process(job());
    expect([...ctx.store.objects.keys()]).toEqual(['u1/albums/a1/preview.pdf']);
    expect(ctx.store.objects.size).toBe(1);
  });

  it('drops a poison payload without failing the row', async () => {
    const ctx = build();
    await ctx.processor.process({ ...job(), payload: {} as { albumId: string; token: string } });
    expect(ctx.pdf.failed).toBeNull();
    expect(ctx.logger.records.some((r) => r.message === 'pdf.bad_payload')).toBe(true);
  });
});
