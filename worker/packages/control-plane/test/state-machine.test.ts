import { describe, expect, it } from 'vitest';
import { defineStateMachine } from '@workerv2/control-plane';
import { isWorkerV2Error } from '@workerv2/errors';

type S = 'a' | 'b' | 'c';
type T = 'go' | 'stop';

const machine = defineStateMachine<S, T>({
  initial: 'a',
  states: ['a', 'b', 'c'],
  terminal: ['c'],
  transitions: [
    { from: 'a', on: 'go', to: 'b' },
    { from: 'b', on: 'go', to: 'c' },
    { from: 'b', on: 'stop', to: 'a' },
  ],
});

describe('defineStateMachine — queries', () => {
  it('resolves legal transitions', () => {
    const r = machine.nextState('a', 'go');
    expect(r.ok && r.value).toBe('b');
  });

  it('rejects illegal transitions with a TransitionError', () => {
    const r = machine.nextState('a', 'stop');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isWorkerV2Error(r.error)).toBe(true);
      expect(r.error.code).toBe('VALIDATION');
    }
  });

  it('canTransition / isTerminal / legalTriggers / hasState', () => {
    expect(machine.canTransition('a', 'go')).toBe(true);
    expect(machine.canTransition('a', 'stop')).toBe(false);
    expect(machine.isTerminal('c')).toBe(true);
    expect(machine.isTerminal('a')).toBe(false);
    expect(machine.legalTriggers('b').sort()).toStrictEqual(['go', 'stop']);
    expect(machine.legalTriggers('c')).toStrictEqual([]);
    expect(machine.hasState('a')).toBe(true);
    expect(machine.hasState('z')).toBe(false);
  });
});

describe('defineStateMachine — construction guards', () => {
  it('throws when initial is not a known state', () => {
    expect(() =>
      defineStateMachine({ initial: 'x', states: ['a'], terminal: [], transitions: [] }),
    ).toThrowError(/Initial state/);
  });

  it('throws on a transition to/from an unknown state', () => {
    expect(() =>
      defineStateMachine({
        initial: 'a',
        states: ['a'],
        terminal: [],
        transitions: [{ from: 'a', on: 'go', to: 'z' }],
      }),
    ).toThrowError(/unknown state/);
  });

  it('throws on duplicate transitions', () => {
    expect(() =>
      defineStateMachine({
        initial: 'a',
        states: ['a', 'b'],
        terminal: [],
        transitions: [
          { from: 'a', on: 'go', to: 'b' },
          { from: 'a', on: 'go', to: 'b' },
        ],
      }),
    ).toThrowError(/Duplicate/);
  });

  it('throws when a terminal state has an outgoing transition', () => {
    expect(() =>
      defineStateMachine({
        initial: 'a',
        states: ['a', 'b'],
        terminal: ['a'],
        transitions: [{ from: 'a', on: 'go', to: 'b' }],
      }),
    ).toThrowError(/Terminal state/);
  });
});
