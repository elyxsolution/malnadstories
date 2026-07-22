import { describe, expect, it } from 'vitest';
import {
  ALBUM_MACHINE,
  ASSET_MACHINE,
  RUN_MACHINE,
  ACTIVE_RUN_STATES,
  isActiveRunState,
} from '@workerv2/control-plane';
import type { AlbumState, AlbumTrigger } from '@workerv2/control-plane';

function walk<S extends string, T extends string>(
  machine: { nextState(from: S, on: T): { ok: boolean; value?: S } },
  from: S,
  triggers: readonly T[],
): S {
  let state = from;
  for (const t of triggers) {
    const r = machine.nextState(state, t);
    if (!r.ok || r.value === undefined) throw new Error(`illegal ${state} --${t}-->`);
    state = r.value;
  }
  return state;
}

describe('ALBUM_MACHINE', () => {
  it('walks the full happy path to the terminal state', () => {
    const path: AlbumTrigger[] = [
      'start_building',
      'submit',
      'start_processing',
      'mark_ready',
      'place_order',
      'start_manufacturing',
      'deliver',
      'archive',
    ];
    const end: AlbumState = walk(ALBUM_MACHINE, ALBUM_MACHINE.initial, path);
    expect(end).toBe('archived');
    expect(ALBUM_MACHINE.isTerminal('archived')).toBe(true);
  });

  it('supports the needs_fix → resubmit loop', () => {
    const end = walk(ALBUM_MACHINE, 'processing', ['request_fix', 'resubmit']);
    expect(end).toBe('submitted');
  });

  it('rejects an illegal transition', () => {
    expect(ALBUM_MACHINE.nextState('draft', 'deliver').ok).toBe(false);
  });
});

describe('ASSET_MACHINE', () => {
  it('walks incoming → deleted', () => {
    const end = walk(ASSET_MACHINE, ASSET_MACHINE.initial, [
      'verify',
      'promote_canonical',
      'derive',
      'reference',
      'archive',
      'delete',
    ]);
    expect(end).toBe('deleted');
    expect(ASSET_MACHINE.isTerminal('deleted')).toBe(true);
  });

  it('allows rejecting an incoming asset', () => {
    expect(walk(ASSET_MACHINE, 'incoming', ['reject'])).toBe('deleted');
  });
});

describe('RUN_MACHINE', () => {
  it('walks pending → running → succeeded', () => {
    expect(walk(RUN_MACHINE, RUN_MACHINE.initial, ['start', 'succeed'])).toBe('succeeded');
  });

  it('allows cancel from pending and running', () => {
    expect(walk(RUN_MACHINE, 'pending', ['cancel'])).toBe('cancelled');
    expect(walk(RUN_MACHINE, 'running', ['cancel'])).toBe('cancelled');
  });

  it('marks terminal states and active states correctly', () => {
    expect(RUN_MACHINE.isTerminal('succeeded')).toBe(true);
    expect(RUN_MACHINE.isTerminal('failed')).toBe(true);
    expect(RUN_MACHINE.isTerminal('cancelled')).toBe(true);
    expect(ACTIVE_RUN_STATES).toStrictEqual(['pending', 'running']);
    expect(isActiveRunState('pending')).toBe(true);
    expect(isActiveRunState('running')).toBe(true);
    expect(isActiveRunState('succeeded')).toBe(false);
  });
});
