import { describe, it, expect } from 'vitest';
import { ConcurrencyController, DEFAULT_LANE, memoryPressureSensor } from '../src/concurrency.js';
import type { ConcurrencyConfig, Pressure } from '../src/concurrency.js';
import { CLEANUP, IMAGE, PDF } from '../src/testing/index.js';

/**
 * ADAPTIVE CONCURRENCY — the decision rules, in isolation.
 *
 * The controller is a pure decision function, so every adaptation rule the phase asks for is
 * directly assertable here without a broker, a worker, or a clock.
 */

const LANES: ConcurrencyConfig = {
  maxInFlight: 6,
  defaultLane: DEFAULT_LANE,
  lanes: {
    [IMAGE]: { min: 1, max: 4 },
    [PDF]: { min: 1, max: 2, heavy: true },
    [CLEANUP]: { min: 1, max: 2 },
  },
  recoveryQuietFraction: 0.5,
};

const TYPES = [IMAGE, PDF, CLEANUP];

function build(pressure: Pressure = 'normal'): ConcurrencyController {
  let current = pressure;
  const controller = new ConcurrencyController({
    config: LANES,
    pressure: () => current,
    pressureTtlMs: 0, // read every time, so a test can change pressure mid-scenario
  });
  (controller as unknown as { setPressure: (p: Pressure) => void }).setPressure = (p): void => {
    current = p;
  };
  return controller;
}

function setPressure(controller: ConcurrencyController, pressure: Pressure): void {
  (controller as unknown as { setPressure: (p: Pressure) => void }).setPressure(pressure);
}

describe('lane allowances', () => {
  it('grants each lane its maximum on an unloaded worker', () => {
    const c = build();
    expect(c.allowanceFor(IMAGE)).toBe(4);
    expect(c.allowanceFor(PDF)).toBe(2);
    expect(c.allowanceFor(CLEANUP)).toBe(2);
  });

  it('admits up to the lane allowance and no further', () => {
    const c = build();
    for (let i = 0; i < 4; i += 1) {
      expect(c.admits(IMAGE)).toBe(true);
      c.acquire(IMAGE);
    }
    expect(c.admits(IMAGE)).toBe(false); // lane full
    c.release(IMAGE);
    expect(c.admits(IMAGE)).toBe(true); // a slot freed
  });

  it('enforces the GLOBAL ceiling even when individual lanes have room', () => {
    const c = build();
    for (let i = 0; i < 4; i += 1) c.acquire(IMAGE);
    c.acquire(PDF);
    c.acquire(CLEANUP);
    expect(c.inFlight).toBe(6);
    // Every lane still has headroom by its own maximum, but the worker is at its global cap.
    expect(c.admits(CLEANUP)).toBe(false);
    expect(c.eligibleTypes(TYPES)).toEqual([]);
  });

  it('uses the default lane for an unknown job type', () => {
    const c = build();
    expect(c.allowanceFor('some-future-processor')).toBe(DEFAULT_LANE.max);
  });
});

describe('adaptation to a heavy lane', () => {
  it('REDUCES image concurrency while a PDF renders', () => {
    const c = build();
    expect(c.allowanceFor(IMAGE)).toBe(4);
    c.acquire(PDF); // Chromium is now busy
    expect(c.allowanceFor(IMAGE)).toBe(2); // halved, per the yield rule
    expect(c.allowanceFor(CLEANUP)).toBe(1);
  });

  it('RESTORES image concurrency when Chromium goes idle', () => {
    const c = build();
    c.acquire(PDF);
    expect(c.allowanceFor(IMAGE)).toBe(2);
    c.release(PDF);
    expect(c.allowanceFor(IMAGE)).toBe(4); // back to maximum
  });

  it('does not make the heavy lane yield to itself', () => {
    const c = build();
    c.acquire(PDF);
    expect(c.allowanceFor(PDF)).toBe(2); // still its own max
  });

  it('never yields a lane below its minimum — no lane can be starved out', () => {
    const c = build();
    c.acquire(PDF);
    expect(c.allowanceFor(CLEANUP)).toBeGreaterThanOrEqual(1);
    expect(c.admits(CLEANUP)).toBe(true); // cleanup still runs alongside a render
  });
});

describe('backpressure under memory pressure', () => {
  it('halves every allowance when memory is ELEVATED', () => {
    const c = build('elevated');
    expect(c.allowanceFor(IMAGE)).toBe(2);
    expect(c.allowanceFor(PDF)).toBe(1);
  });

  it('stops intake entirely when memory is CRITICAL', () => {
    const c = build('critical');
    expect(c.allowanceFor(IMAGE)).toBe(0);
    expect(c.admits(IMAGE)).toBe(false);
    expect(c.eligibleTypes(TYPES)).toEqual([]); // the worker polls for nothing
  });

  it('lets in-flight work finish under critical pressure rather than cancelling it', () => {
    const c = build();
    c.acquire(IMAGE);
    c.acquire(IMAGE);
    setPressure(c, 'critical');
    // Intake stops, but the two running jobs are untouched — finishing them is what frees memory.
    expect(c.eligibleTypes(TYPES)).toEqual([]);
    expect(c.inFlight).toBe(2);
    c.release(IMAGE);
    c.release(IMAGE);
    setPressure(c, 'normal');
    expect(c.eligibleTypes(TYPES)).toEqual(TYPES); // recovers automatically
  });

  it('a throwing pressure sensor degrades to normal instead of stopping the worker', () => {
    const c = new ConcurrencyController({
      config: LANES,
      pressure: () => {
        throw new Error('sensor failed');
      },
      pressureTtlMs: 0,
    });
    expect(c.pressure()).toBe('normal');
    expect(c.admits(IMAGE)).toBe(true);
  });

  it('caches pressure readings so a hot dispatch loop cannot hammer the sensor', () => {
    let reads = 0;
    let now = 0;
    const c = new ConcurrencyController({
      config: LANES,
      pressure: () => {
        reads += 1;
        return 'normal';
      },
      pressureTtlMs: 100,
      clock: () => now,
    });
    for (let i = 0; i < 50; i += 1) c.admits(IMAGE);
    expect(reads).toBe(1);
    now = 150;
    c.admits(IMAGE);
    expect(reads).toBe(2);
  });
});

describe('recovery throttling', () => {
  it('allows recovery on a quiet worker', () => {
    expect(build().allowRecovery()).toBe(true);
  });

  it('DEFERS recovery once production load passes the quiet fraction', () => {
    const c = build(); // maxInFlight 6, fraction 0.5 → quiet at ≤3
    c.acquire(IMAGE);
    c.acquire(IMAGE);
    c.acquire(IMAGE);
    expect(c.allowRecovery()).toBe(true);
    c.acquire(IMAGE);
    expect(c.allowRecovery()).toBe(false); // 4 > 3
  });

  it('defers recovery under ANY memory pressure, even on an idle worker', () => {
    expect(build('elevated').allowRecovery()).toBe(false);
    expect(build('critical').allowRecovery()).toBe(false);
  });

  it('resumes recovery automatically once load drops', () => {
    const c = build();
    for (let i = 0; i < 4; i += 1) c.acquire(IMAGE);
    expect(c.allowRecovery()).toBe(false);
    c.release(IMAGE);
    expect(c.allowRecovery()).toBe(true);
  });
});

describe('dynamic reconfiguration', () => {
  it('applies a new configuration without a restart', () => {
    const c = build();
    expect(c.allowanceFor(IMAGE)).toBe(4);
    c.reconfigure({ lanes: { ...LANES.lanes, [IMAGE]: { min: 1, max: 8 } }, maxInFlight: 10 });
    expect(c.allowanceFor(IMAGE)).toBe(8);
    expect(c.configuration.maxInFlight).toBe(10);
  });

  it('keeps existing in-flight accounting across a reconfiguration', () => {
    const c = build();
    c.acquire(IMAGE);
    c.reconfigure({ maxInFlight: 2 });
    expect(c.inFlight).toBe(1);
    expect(c.activeOf(IMAGE)).toBe(1);
  });
});

describe('memory pressure sensor', () => {
  it('maps RSS onto the same thresholds the health probe uses', () => {
    const usage = (rss: number): NodeJS.MemoryUsage =>
      ({ rss, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 }) as NodeJS.MemoryUsage;
    const sensor = (rss: number): Pressure => memoryPressureSensor(100, 200, () => usage(rss))();

    expect(sensor(50)).toBe('normal');
    expect(sensor(150)).toBe('elevated');
    expect(sensor(250)).toBe('critical');
  });
});

describe('decision snapshot', () => {
  it('reports the live decision for diagnostics', () => {
    const c = build();
    c.acquire(PDF);
    const snapshot = c.snapshot(TYPES);
    expect(snapshot).toMatchObject({
      pressure: 'normal',
      maxInFlight: 6,
      totalActive: 1,
      recoveryAllowed: true,
    });
    expect(snapshot.lanes[PDF]).toEqual({ active: 1, allowance: 2, max: 2 });
    expect(snapshot.lanes[IMAGE]).toEqual({ active: 0, allowance: 2, max: 4 }); // yielding
    expect(snapshot.admitting).toContain(IMAGE);
  });
});
