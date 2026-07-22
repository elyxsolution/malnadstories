import { describe, expect, it } from 'vitest';
import { VersionSet, VERSION_COMPONENTS } from '@workerv2/control-plane';
import { unwrap } from './helpers.js';

describe('VersionSet', () => {
  it('creates from a partial map and exposes pins', () => {
    const vs = unwrap(VersionSet.create({ workerRuntime: '1.2.3', manifest: '0.1.0' }));
    expect(vs.get('workerRuntime')).toBe('1.2.3');
    expect(vs.has('manifest')).toBe(true);
    expect(vs.has('pdfEngine')).toBe(false);
    expect(vs.get('pdfEngine')).toBeUndefined();
    expect(vs.components()).toStrictEqual(['workerRuntime', 'manifest']);
  });

  it('returns pins in canonical component order', () => {
    const vs = unwrap(VersionSet.create({ manifest: '0.1.0', workerRuntime: '1.0.0' }));
    // canonical order puts workerRuntime before manifest regardless of input order
    expect(vs.components()).toStrictEqual(['workerRuntime', 'manifest']);
    expect(vs.toJSON()).toStrictEqual({ workerRuntime: '1.0.0', manifest: '0.1.0' });
  });

  it('rejects non-semver versions', () => {
    const r = VersionSet.create({ workerRuntime: 'v1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION');
  });

  it('accepts semver with pre-release/build metadata', () => {
    expect(VersionSet.create({ manifest: '1.0.0-rc.1' }).ok).toBe(true);
    expect(VersionSet.create({ manifest: '1.0.0+build.5' }).ok).toBe(true);
  });

  it('require() gates on missing components', () => {
    const vs = unwrap(VersionSet.create({ workerRuntime: '1.0.0' }));
    expect(vs.require(['workerRuntime']).ok).toBe(true);
    const missing = vs.require(['workerRuntime', 'manifest']);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.message).toContain('manifest');
  });

  it('equals compares by pinned components + versions', () => {
    const a = unwrap(VersionSet.create({ workerRuntime: '1.0.0', manifest: '0.1.0' }));
    const b = unwrap(VersionSet.create({ manifest: '0.1.0', workerRuntime: '1.0.0' }));
    const c = unwrap(VersionSet.create({ workerRuntime: '1.0.1', manifest: '0.1.0' }));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('exposes all known version components', () => {
    expect(VERSION_COMPONENTS).toContain('workerRuntime');
    expect(VERSION_COMPONENTS).toContain('vendorProfile');
    expect(VERSION_COMPONENTS.length).toBe(12);
  });
});
