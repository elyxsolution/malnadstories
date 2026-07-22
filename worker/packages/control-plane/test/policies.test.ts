import { describe, expect, it } from 'vitest';
import { canStartRun } from '@workerv2/control-plane';
import type { RunState } from '@workerv2/control-plane';

describe('canStartRun (INV-6: one active run per album)', () => {
  it('permits starting when no runs exist', () => {
    expect(canStartRun([]).ok).toBe(true);
  });

  it('permits starting when all existing runs are terminal', () => {
    const states: RunState[] = ['succeeded', 'failed', 'cancelled'];
    expect(canStartRun(states).ok).toBe(true);
  });

  it('forbids starting when a pending run exists', () => {
    const r = canStartRun(['pending']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVARIANT');
  });

  it('forbids starting when a running run exists', () => {
    const r = canStartRun(['succeeded', 'running']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('active run');
  });
});
