import { describe, it, expect } from 'vitest';
import { WorkerHost, ServiceRegistry, hostCapabilityOffers } from '@workerv2/worker-host';
import { defaultCapabilityNegotiator } from '@workerv2/execution-adapter';
import { RENDER_CAPABILITY, ASSEMBLE_CAPABILITY } from '@workerv2/manifest';
import { seedAlbumBlueprint } from './helpers.js';

describe('processor registration', () => {
  it('registers every completed processor under one resolver', () => {
    const host = new WorkerHost();
    const names = host.processors.names();
    expect(names).toEqual(
      [
        'album.assemble',
        'document.export.pdf',
        'image.color-normalize',
        'image.decode',
        'image.exif-orientation',
        'image.format-normalize',
        'image.metadata',
        'image.validate',
        'surface.render',
      ].sort(),
    );
  });

  it('resolves each registered processor by name (independently deployable)', () => {
    const host = new WorkerHost();
    for (const name of host.processors.names()) {
      const processor = host.processors.resolve(name);
      expect(processor?.descriptor.name).toBe(name);
    }
    expect(host.processors.resolve('does.not.exist')).toBeNull();
  });
});

describe('dependency composition (explicit DI; no globals)', () => {
  it('registers stores, backends, repositories, and the negotiator in the service registry', () => {
    const host = new WorkerHost();
    expect(host.services.names()).toEqual(
      [
        'artifactStore',
        'backends',
        'capabilityNegotiator',
        'capabilityOffers',
        'processors',
        'repositories',
      ].sort(),
    );
    expect(host.services.resolve('artifactStore')).toBe(host.store);
    expect(host.services.has('repositories')).toBe(true);
  });

  it('two hosts are fully isolated (no shared/ambient state)', async () => {
    const a = new WorkerHost();
    const b = new WorkerHost();
    await a.run(seedAlbumBlueprint(a, 1));
    // b's store is untouched by a's run.
    expect(b.store.size).toBe(0);
    expect(a.store.size).toBeGreaterThan(0);
  });

  it('a fresh ServiceRegistry rejects duplicate registration', () => {
    const registry = new ServiceRegistry().register('x', 1);
    expect(() => registry.register('x', 2)).toThrow(/already registered/);
    expect(() => registry.resolve('missing')).toThrow(/not registered/);
  });
});

describe('capability negotiation', () => {
  it('the host offers exactly the manifest render/assemble capabilities', () => {
    const offers = hostCapabilityOffers();
    expect(offers.map((o) => o.name).sort()).toEqual(
      [ASSEMBLE_CAPABILITY, RENDER_CAPABILITY].sort(),
    );
  });

  it('negotiation is satisfied for offered capabilities and unmet otherwise', () => {
    const offers = hostCapabilityOffers();
    const ok = defaultCapabilityNegotiator.negotiate([{ name: RENDER_CAPABILITY }], offers);
    expect(ok.satisfied).toBe(true);
    const bad = defaultCapabilityNegotiator.negotiate([{ name: 'gpu.raytrace' }], offers);
    expect(bad.satisfied).toBe(false);
    expect(bad.unmet.map((u) => u.name)).toEqual(['gpu.raytrace']);
  });

  it('a run whose capabilities are not offered fails deterministically (no processor runs)', async () => {
    const host = new WorkerHost();
    const blueprint = seedAlbumBlueprint(host, 1);
    const prepared = host.prepare(blueprint);
    // Drive with EMPTY offers → every node hits an unmet capability → permanent failure.
    const { executeRun, InMemoryJournalStore, InMemoryEventSink, manualClock, immediateWaiter } =
      await import('@workerv2/execution-adapter');
    const { makeRunId, makeTimestamp } = await import('@workerv2/control-plane');
    const runId = makeRunId('run-x');
    const at = makeTimestamp('2026-01-01T00:00:00.000Z');
    if (!runId.ok || !at.ok) throw new Error('id');
    const { state } = await executeRun({
      coordinator: prepared.coordinator,
      runId: runId.value,
      journal: new InMemoryJournalStore(),
      events: new InMemoryEventSink(),
      options: {
        clock: manualClock(at.value),
        resolver: host.processors,
        negotiator: defaultCapabilityNegotiator,
        offers: [],
        waiter: immediateWaiter,
      },
    });
    expect(state.status).not.toBe('succeeded');
  });
});
