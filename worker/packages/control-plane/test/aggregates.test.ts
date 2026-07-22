import { describe, expect, it } from 'vitest';
import {
  Album,
  Asset,
  Run,
  VersionSet,
  makeAlbumId,
  makeAssetId,
  makeRunId,
} from '@workerv2/control-plane';
import { unwrap, makeCtx } from './helpers.js';

const albumId = unwrap(makeAlbumId('alb-1'));
const assetId = unwrap(makeAssetId('ast-1'));
const runId = unwrap(makeRunId('run-1'));

describe('Album aggregate', () => {
  it('creates in the draft state with a creation event + audit', () => {
    const out = unwrap(
      Album.create({ id: albumId, title: '  Goa Trip  ' }, makeCtx('2026-07-22T00:00:00Z')),
    );
    expect(out.aggregate.status).toBe('draft');
    expect(out.aggregate.title).toBe('Goa Trip');
    expect(out.event).toMatchObject({ kind: 'domain', type: 'album.created', subjectId: 'alb-1' });
    expect(out.audit).toMatchObject({
      entityType: 'album',
      action: 'album.created',
      toState: 'draft',
    });
    expect(Object.isFrozen(out.aggregate)).toBe(true);
  });

  it('rejects an empty or too-long title', () => {
    expect(Album.create({ id: albumId, title: '   ' }, makeCtx('2026-07-22T00:00:00Z')).ok).toBe(
      false,
    );
    expect(
      Album.create({ id: albumId, title: 'x'.repeat(121) }, makeCtx('2026-07-22T00:00:00Z')).ok,
    ).toBe(false);
  });

  it('transitions immutably, leaving the original unchanged', () => {
    const created = unwrap(
      Album.create({ id: albumId, title: 'Goa' }, makeCtx('2026-07-22T00:00:00Z')),
    );
    const draft = created.aggregate;
    const moved = unwrap(draft.transition('start_building', makeCtx('2026-07-22T01:00:00Z')));
    expect(draft.status).toBe('draft'); // original untouched
    expect(moved.aggregate.status).toBe('building');
    expect(moved.aggregate.updatedAt).not.toBe(draft.updatedAt);
    expect(moved.event.type).toBe('album.building');
    expect(moved.audit).toMatchObject({ fromState: 'draft', toState: 'building' });
  });

  it('returns a TransitionError on an illegal transition', () => {
    const draft = unwrap(
      Album.create({ id: albumId, title: 'Goa' }, makeCtx('2026-07-22T00:00:00Z')),
    ).aggregate;
    const r = draft.transition('deliver', makeCtx('2026-07-22T01:00:00Z'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION');
  });

  it('is deterministic: identical inputs produce deep-equal outputs', () => {
    const a = unwrap(Album.create({ id: albumId, title: 'Goa' }, makeCtx('2026-07-22T00:00:00Z')));
    const b = unwrap(Album.create({ id: albumId, title: 'Goa' }, makeCtx('2026-07-22T00:00:00Z')));
    expect({ ...a.aggregate }).toStrictEqual({ ...b.aggregate });
    expect(a.event).toStrictEqual(b.event);
    expect(a.audit).toStrictEqual(b.audit);
  });
});

describe('Asset aggregate', () => {
  it('creates in the incoming state and transitions', () => {
    const created = Asset.create({ id: assetId, albumId }, makeCtx('2026-07-22T00:00:00Z'));
    expect(created.aggregate.status).toBe('incoming');
    expect(created.aggregate.albumId).toBe('alb-1');
    const verified = unwrap(
      created.aggregate.transition('verify', makeCtx('2026-07-22T01:00:00Z')),
    );
    expect(verified.aggregate.status).toBe('verified');
    expect(created.aggregate.status).toBe('incoming'); // immutable
  });

  it('rejects an illegal transition', () => {
    const created = Asset.create({ id: assetId, albumId }, makeCtx('2026-07-22T00:00:00Z'));
    expect(created.aggregate.transition('derive', makeCtx('2026-07-22T01:00:00Z')).ok).toBe(false);
  });
});

describe('Run aggregate', () => {
  const versions = unwrap(VersionSet.create({ workerRuntime: '1.0.0', manifest: '0.1.0' }));

  it('creates pending with a frozen version set', () => {
    const created = Run.create({ id: runId, albumId, versions }, makeCtx('2026-07-22T00:00:00Z'));
    expect(created.aggregate.status).toBe('pending');
    expect(created.aggregate.isActive()).toBe(true);
    expect(created.aggregate.versions.get('workerRuntime')).toBe('1.0.0');
    expect(created.event.type).toBe('run.created');
  });

  it('carries the SAME frozen versions across transitions (INV-11)', () => {
    const created = Run.create({ id: runId, albumId, versions }, makeCtx('2026-07-22T00:00:00Z'));
    const started = unwrap(created.aggregate.transition('start', makeCtx('2026-07-22T01:00:00Z')));
    const succeeded = unwrap(
      started.aggregate.transition('succeed', makeCtx('2026-07-22T02:00:00Z')),
    );
    expect(succeeded.aggregate.status).toBe('succeeded');
    expect(succeeded.aggregate.isTerminal()).toBe(true);
    // The version set is preserved unchanged through every transition.
    expect(succeeded.aggregate.versions).toBe(created.aggregate.versions);
    expect(succeeded.aggregate.versions.equals(versions)).toBe(true);
  });

  it('rejects an illegal transition (succeed before start)', () => {
    const created = Run.create({ id: runId, albumId, versions }, makeCtx('2026-07-22T00:00:00Z'));
    expect(created.aggregate.transition('succeed', makeCtx('2026-07-22T01:00:00Z')).ok).toBe(false);
  });
});
