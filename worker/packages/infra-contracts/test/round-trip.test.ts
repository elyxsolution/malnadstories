import { describe, expect, it } from 'vitest';
import {
  albumToRecord,
  recordToAlbum,
  assetToRecord,
  recordToAsset,
  runToRecord,
  recordToRun,
  auditToRecord,
  recordToAudit,
  albumMapper,
} from '@workerv2/infra-contracts';
import { sampleAlbum, sampleAsset, sampleRun, sampleAudit, unwrap } from './helpers.js';

// Serialization symmetry: domain → record → domain → record must be stable, and the
// reconstituted aggregate must round-trip through the persistence boundary unchanged.

describe('serialization symmetry (save → load → save)', () => {
  it('Album', () => {
    const album = sampleAlbum();
    const rec1 = albumToRecord(album);
    const back = unwrap(recordToAlbum(rec1));
    const rec2 = albumToRecord(back);
    expect(rec2).toStrictEqual(rec1);
    expect({ ...back }).toStrictEqual({ ...album });
  });

  it('Asset', () => {
    const asset = sampleAsset();
    const rec1 = assetToRecord(asset);
    const rec2 = assetToRecord(unwrap(recordToAsset(rec1)));
    expect(rec2).toStrictEqual(rec1);
  });

  it('Run (frozen version set survives the round trip)', () => {
    const run = sampleRun();
    const rec1 = runToRecord(run);
    const back = unwrap(recordToRun(rec1));
    const rec2 = runToRecord(back);
    expect(rec2).toStrictEqual(rec1);
    expect(back.versions.equals(run.versions)).toBe(true);
  });

  it('AuditRecord', () => {
    const audit = sampleAudit();
    const rec1 = auditToRecord(audit);
    const rec2 = auditToRecord(unwrap(recordToAudit(rec1)));
    expect(rec2).toStrictEqual(rec1);
  });
});

describe('mapper objects implement the full bidirectional contract', () => {
  it('albumMapper.toRecord / toDomain compose', () => {
    const album = sampleAlbum();
    const back = unwrap(albumMapper.toDomain(albumMapper.toRecord(album)));
    expect(back.id).toBe(album.id);
    expect(back.status).toBe(album.status);
  });

  it('inbound mapping rejects a corrupt record', () => {
    const bad = { ...albumToRecord(sampleAlbum()), status: 'not-real' };
    expect(recordToAlbum(bad).ok).toBe(false);
  });
});
