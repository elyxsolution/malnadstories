/**
 * BLUEPRINT DRAFTS NEVER GENERATE PDFs (Phase 6).
 *
 * A blueprint draft album (0046) is an admin authoring scaffold, destroyed by CASCADE whenever its
 * blueprint is deleted or re-opened. If one ever acquired a PDF, that CASCADE would drop the
 * `album_pdfs` row — the ONLY record of the R2 key — leaving `{user}/albums/{album}/preview.pdf`
 * orphaned AND unreclaimable, because the orphan-cleanup key parser positively excludes
 * `preview.pdf` as a non-raw object class. There is no recovery, so prevention is absolute.
 *
 * The gate sits ABOVE the force/validate/override branches on purpose: `override` is an audited
 * bypass of QUALITY gates (content validation, render readiness) and must never double as a
 * licence to create an unreclaimable orphan. That ordering is the thing most at risk from a future
 * refactor, so it is what these tests pin.
 *
 * The real `startAlbumPdfGeneration` runs; only its Supabase client and queue are stubbed. If the
 * gate ever regresses, the stub records an enqueue that should never have happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  album: null as { id: string; blueprint_draft_of: string | null } | null,
  pdfRow: null as { status: string; requested_at: string | null } | null,
  enqueued: [] as { albumId: string }[],
  updates: [] as Record<string, unknown>[],
};

/** Records every write so a leaked generation is provable, not merely absent from a return value. */
function serviceStub() {
  const table = (name: string) => {
    const b: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () =>
        name === 'albums' ? { data: state.album } : { data: state.pdfRow },
      upsert: async (row: Record<string, unknown>) => { state.updates.push({ table: name, ...row }); return { error: null }; },
      update: (row: Record<string, unknown>) => { state.updates.push({ table: name, ...row }); return chain; },
      insert: async (row: Record<string, unknown>) => { state.updates.push({ table: name, ...row }); return { error: null }; },
      then: undefined,
    };
    return chain as unknown as typeof b;
  };
  return { from: table } as never;
}

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceStub() }));
vi.mock('@/lib/queue', () => ({
  enqueueAlbumPdf: async (albumId: string) => { state.enqueued.push({ albumId }); return 'job-1'; },
}));
vi.mock('@/lib/worker/health', () => ({
  checkWorker: async () => ({ ready: true }),
  probeWorker: async () => ({ ready: true }),
}));

// Static import is safe: Vitest hoists every vi.mock() above it.
import { startAlbumPdfGeneration } from '@/lib/pdf/generate';

const DRAFT_ALBUM = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BLUEPRINT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

beforeEach(() => {
  state.album = null;
  state.pdfRow = null;
  state.enqueued = [];
  state.updates = [];
});

describe('blueprint draft PDF block', () => {
  it('refuses a blueprint draft and enqueues nothing', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: BLUEPRINT };
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM);
    expect(res).toMatchObject({ ok: false, error: 'Blueprint draft albums cannot generate PDFs.' });
    expect(state.enqueued).toHaveLength(0);
  });

  it('FORCE cannot bypass the block', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: BLUEPRINT };
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM, { force: true });
    expect(res).toMatchObject({ ok: false, error: 'Blueprint draft albums cannot generate PDFs.' });
    expect(state.enqueued).toHaveLength(0);
  });

  it('OVERRIDE — the audited admin bypass — cannot bypass the block either', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: BLUEPRINT };
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM, { override: true, validate: false, force: true });
    expect(res).toMatchObject({ ok: false, error: 'Blueprint draft albums cannot generate PDFs.' });
    expect(state.enqueued).toHaveLength(0);
  });

  it('no combination of options can produce an enqueue for a draft', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: BLUEPRINT };
    for (const force of [true, false]) {
      for (const override of [true, false]) {
        for (const validate of [true, false]) {
          const res = await startAlbumPdfGeneration(DRAFT_ALBUM, { force, override, validate, nudge: false });
          expect(res).toMatchObject({ ok: false, error: 'Blueprint draft albums cannot generate PDFs.' });
        }
      }
    }
    expect(state.enqueued).toHaveLength(0);
    // Nothing may even be marked 'generating' — that row is what a CASCADE would later orphan.
    expect(state.updates).toHaveLength(0);
  });

  it('a missing album is refused before anything is written', async () => {
    state.album = null;
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM);
    expect(res.ok).toBe(false);
    expect(state.enqueued).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe('idempotency short-circuits for a normal album', () => {
  it('an already-ready PDF is not regenerated by a non-forced caller', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: null };
    state.pdfRow = { status: 'ready', requested_at: null };
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM, { nudge: false });
    expect(res).toMatchObject({ ok: true, skipped: 'already-ready' });
    expect(state.enqueued).toHaveLength(0);
  });

  it('an in-flight generation is not duplicated (settlement may call twice)', async () => {
    state.album = { id: DRAFT_ALBUM, blueprint_draft_of: null };
    state.pdfRow = { status: 'generating', requested_at: new Date().toISOString() };
    const res = await startAlbumPdfGeneration(DRAFT_ALBUM, { nudge: false });
    expect(res).toMatchObject({ ok: true, skipped: 'in-progress' });
    expect(state.enqueued).toHaveLength(0);
  });
});
