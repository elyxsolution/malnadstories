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
  RenderTargetUnreachableError,
  unreachableAdvice,
} from '../src/processors/pdf/page-renderer.js';
import type {
  AlbumOwner,
  AlbumPdfStore,
  PdfState,
  StaleGeneration,
} from '../src/processors/pdf/album-pdf-repository.js';
import type { PdfFailureCode, PdfKind, PdfStage } from '../src/processors/pdf/pdf-contract.js';
import { hashToken, redactToken } from '../src/processors/pdf/pdf-contract.js';
import { validPdf } from './support/pdf-fixture.js';

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
  /** Every kind the pipeline asked about — proves each call is artifact-scoped (0058). */
  readonly kinds: PdfKind[] = [];
  ready: { albumId: string; kind: PdfKind; r2Key: string } | null = null;
  failed: { albumId: string; kind: PdfKind; message: string; code: PdfFailureCode } | null = null;
  failMarkReady = false;

  async findAlbumOwner(): Promise<AlbumOwner | null> {
    return this.owner;
  }
  async findPdfState(_albumId: string, kind: PdfKind): Promise<PdfState | null> {
    this.kinds.push(kind);
    return this.state;
  }
  async setStage(_albumId: string, kind: PdfKind, stage: PdfStage): Promise<void> {
    this.kinds.push(kind);
    this.stages.push(stage);
  }
  async markReady(albumId: string, kind: PdfKind, r2Key: string): Promise<boolean> {
    if (this.failMarkReady) throw new Error('db down');
    this.ready = { albumId, kind, r2Key };
    return true; // a row was updated (the album still exists)
  }
  async markFailed(albumId: string, kind: PdfKind, message: string, code: PdfFailureCode): Promise<void> {
    this.failed = { albumId, kind, message, code };
  }
  async findStaleGenerating(): Promise<readonly StaleGeneration[]> {
    return [];
  }
  async redrive(): Promise<void> {}
}

class FakeRenderer implements PageRenderer {
  readonly calls: RenderRequest[] = [];
  mode: 'ok' | 'print-error' | 'crash' | 'empty' | 'refused' | 'dns' = 'ok';
  /** A geometrically valid render — the pipeline verifies the bytes before uploading them. */
  pdf = validPdf();
  async render(request: RenderRequest): Promise<RenderResult> {
    this.calls.push(request);
    if (this.mode === 'print-error') throw new PrintRouteError(500);
    if (this.mode === 'crash') throw new RendererCrashedError('Target closed');
    if (this.mode === 'empty') throw new Error('page.pdf produced 0 bytes');
    // The REAL renderer classifies before throwing; these reproduce what it hands the pipeline.
    // Faithful to PuppeteerPageRenderer: it redacts, then appends the operator advice.
    if (this.mode === 'refused' || this.mode === 'dns') {
      const reason = this.mode;
      const chromium =
        reason === 'refused'
          ? `net::ERR_CONNECTION_REFUSED at ${request.url}`
          : `net::ERR_NAME_NOT_RESOLVED at ${request.url}`;
      throw new RenderTargetUnreachableError(
        reason,
        request.origin,
        `${redactToken(chromium)} — ${unreachableAdvice(reason, request.origin)}`,
      );
    }
    return { pdf: this.pdf, httpStatus: 200 };
  }
}

const TOKEN = 'tok-abc';
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function generatingState(token = TOKEN, expiresAt: string | null = FUTURE): PdfState {
  return { status: 'generating', tokenHash: hashToken(token), tokenExpiresAt: expiresAt };
}

function job(
  albumId = 'a1',
  token = TOKEN,
  kind: PdfKind = 'preview',
): Job<{ albumId: string; token: string; kind: PdfKind }> {
  return {
    id: 'job-1',
    type: ALBUM_PDF_TYPE,
    payload: { albumId, token, kind },
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

describe('worker → Next.js connectivity failures', () => {
  /**
   * The incident: every PDF failed with net::ERR_CONNECTION_REFUSED because the render base URL
   * defaulted to localhost while the app ran elsewhere. It used to surface as a generic
   * `render_engine_failed` — pointing an operator at Chromium, which was fine. These pin the
   * distinct diagnosis, and pin that the token never reaches the stored error.
   */
  it('records a refused connection as render_unreachable, not a Chromium fault', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'refused';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('render_unreachable');
    expect(ctx.pdf.failed?.code).not.toBe('render_engine_failed');
  });

  it('records an unresolvable host as render_dns_failed', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'dns';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('render_dns_failed');
  });

  it('REDACTS the token from the stored error, which the admin console renders', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'refused';
    await ctx.processor.process(job());
    const stored = ctx.pdf.failed!.message;
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain('t=[REDACTED]');
    // The diagnosis survives redaction.
    expect(stored).toContain('ERR_CONNECTION_REFUSED');
    expect(stored).toMatch(/APP_URL/);
  });

  it('keeps the token out of every emitted log record too', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'refused';
    await ctx.processor.process(job());
    expect(JSON.stringify(ctx.logger.records)).not.toContain(TOKEN);
  });

  it('stays TRANSIENT, so the recovery sweep re-drives once the app is reachable', async () => {
    // A misconfiguration is fixed by a human, but an app that is merely not up yet fixes itself.
    // Marking this permanent would strand every album until an admin noticed.
    const ctx = build();
    ctx.pdf.state = generatingState();
    ctx.renderer.mode = 'refused';
    await ctx.processor.process(job());
    expect(ctx.pdf.failed?.code).toBe('render_unreachable');
  });

  it('hands the renderer the ORIGIN separately from the token-bearing URL', async () => {
    const ctx = build();
    ctx.pdf.state = generatingState();
    await ctx.processor.process(job());
    const req = ctx.renderer.calls[0]!;
    expect(req.origin).toBe('https://app.example.com');
    expect(req.origin).not.toContain('t=');
    expect(req.url).toContain(`t=${TOKEN}`);
  });

  it('drives the configured base URL for every kind — never a hardcoded localhost', async () => {
    for (const [kind, path] of [
      ['preview', '/albums/a1/print?t='],
      ['print_cover', '/albums/a1/print/cover?t='],
      ['print_content', '/albums/a1/print/content?t='],
    ] as const) {
      const ctx = build();
      ctx.pdf.state = generatingState();
      await ctx.processor.process(job('a1', TOKEN, kind));
      const url = ctx.renderer.calls[0]!.url;
      expect(url.startsWith('https://app.example.com')).toBe(true);
      expect(url).toContain(path);
      expect(url).not.toContain('localhost');
    }
  });
});

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
    expect(ctx.pdf.ready).toEqual({ albumId: 'a1', kind: 'preview', r2Key: 'u1/albums/a1/preview.pdf' });
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
    // Phase I-4: stated as a `processor.skipped` event, rendered by the default logging sink.
    expect(ctx.logger.records.find((r) => r.message === 'processor.skipped')?.detail).toMatchObject(
      { reason: 'superseded' },
    );
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
    await ctx.processor.process({ ...job(), payload: {} as { albumId: string; token: string; kind: PdfKind } });
    expect(ctx.pdf.failed).toBeNull();
    expect(
      ctx.logger.records.find((r) => r.message === 'processor.rejected')?.detail,
    ).toMatchObject({ reason: 'bad_payload' });
  });
});
