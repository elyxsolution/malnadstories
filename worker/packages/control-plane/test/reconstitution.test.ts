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
import { unwrap, timestamp } from './helpers.js';

const albumId = unwrap(makeAlbumId('alb-1'));
const assetId = unwrap(makeAssetId('ast-1'));
const runId = unwrap(makeRunId('run-1'));
const t0 = timestamp('2026-07-22T00:00:00Z');
const t1 = timestamp('2026-07-22T01:00:00Z');

describe('Album.reconstitute', () => {
  it('rebuilds a mid-lifecycle album WITHOUT emitting events', () => {
    const album = unwrap(
      Album.reconstitute({
        id: albumId,
        title: 'Goa',
        status: 'submitted',
        createdAt: t0,
        updatedAt: t1,
      }),
    );
    expect(album.status).toBe('submitted');
    expect(album.title).toBe('Goa');
    expect(album.createdAt).toBe(t0);
    expect(album.updatedAt).toBe(t1);
    expect(Object.isFrozen(album)).toBe(true);
  });

  it('enforces invariants: rejects an unknown status and a bad title', () => {
    expect(
      Album.reconstitute({
        id: albumId,
        title: 'Goa',
        status: 'bogus',
        createdAt: t0,
        updatedAt: t1,
      }).ok,
    ).toBe(false);
    expect(
      Album.reconstitute({
        id: albumId,
        title: '   ',
        status: 'draft',
        createdAt: t0,
        updatedAt: t1,
      }).ok,
    ).toBe(false);
  });
});

describe('Asset.reconstitute', () => {
  it('rebuilds and validates status', () => {
    const asset = unwrap(
      Asset.reconstitute({
        id: assetId,
        albumId,
        status: 'canonical',
        createdAt: t0,
        updatedAt: t1,
      }),
    );
    expect(asset.status).toBe('canonical');
    expect(
      Asset.reconstitute({ id: assetId, albumId, status: 'nope', createdAt: t0, updatedAt: t1 }).ok,
    ).toBe(false);
  });
});

describe('Run.reconstitute', () => {
  it('rebuilds with the frozen version set and validates status', () => {
    const versions = unwrap(VersionSet.create({ workerRuntime: '1.0.0' }));
    const run = unwrap(
      Run.reconstitute({
        id: runId,
        albumId,
        status: 'running',
        versions,
        createdAt: t0,
        updatedAt: t1,
      }),
    );
    expect(run.status).toBe('running');
    expect(run.isActive()).toBe(true);
    expect(run.versions.equals(versions)).toBe(true);
    expect(
      Run.reconstitute({
        id: runId,
        albumId,
        status: 'weird',
        versions,
        createdAt: t0,
        updatedAt: t1,
      }).ok,
    ).toBe(false);
  });
});
