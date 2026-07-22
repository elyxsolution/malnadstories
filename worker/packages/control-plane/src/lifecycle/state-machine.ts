import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { InvariantError } from '@workerv2/errors';
import { TransitionError } from '../errors.js';

/** A single legal edge: from state `from`, trigger `on` moves to state `to`. */
export interface Transition<S extends string, T extends string> {
  readonly from: S;
  readonly on: T;
  readonly to: S;
}

/** Declarative state-machine definition (data, not code). */
export interface StateMachineDefinition<S extends string, T extends string> {
  readonly initial: S;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  readonly transitions: readonly Transition<S, T>[];
}

/** A compiled, immutable state machine with pure query/transition operations. */
export interface StateMachine<S extends string, T extends string> extends StateMachineDefinition<
  S,
  T
> {
  /** Resolve the next state, or a `TransitionError` if the edge is illegal. */
  nextState(from: S, on: T): Result<S, TransitionError>;
  /** Whether `from --on-->` is a legal edge. */
  canTransition(from: S, on: T): boolean;
  /** Whether `state` is terminal (no outgoing edges). */
  isTerminal(state: S): boolean;
  /** All triggers legal from `state`. */
  legalTriggers(from: S): T[];
  /** Type guard: whether an arbitrary string is a known state. */
  hasState(state: string): state is S;
}

const key = (from: string, on: string): string => `${from}::${on}`;

/**
 * Compile a declarative definition into a `StateMachine`. Validation here guards against
 * developer error (unknown/duplicate/terminal-with-outgoing edges) and throws `InvariantError`
 * at construction time — never at runtime. Runtime transition attempts return `Result`.
 */
export function defineStateMachine<S extends string, T extends string>(
  def: StateMachineDefinition<S, T>,
): StateMachine<S, T> {
  const states = new Set<string>(def.states);
  if (!states.has(def.initial)) {
    throw new InvariantError(`Initial state "${def.initial}" is not in states`);
  }
  for (const t of def.terminal) {
    if (!states.has(t)) throw new InvariantError(`Terminal state "${t}" is not in states`);
  }

  const lookup = new Map<string, S>();
  const outgoing = new Map<S, T[]>();
  const terminal = new Set<string>(def.terminal);

  for (const tr of def.transitions) {
    if (!states.has(tr.from))
      throw new InvariantError(`Transition from unknown state "${tr.from}"`);
    if (!states.has(tr.to)) throw new InvariantError(`Transition to unknown state "${tr.to}"`);
    if (terminal.has(tr.from)) {
      throw new InvariantError(`Terminal state "${tr.from}" cannot have an outgoing transition`);
    }
    const k = key(tr.from, tr.on);
    if (lookup.has(k)) throw new InvariantError(`Duplicate transition ${k}`);
    lookup.set(k, tr.to);
    const list = outgoing.get(tr.from) ?? [];
    list.push(tr.on);
    outgoing.set(tr.from, list);
  }

  const machine: StateMachine<S, T> = {
    initial: def.initial,
    states: def.states,
    terminal: def.terminal,
    transitions: def.transitions,
    nextState(from, on) {
      const to = lookup.get(key(from, on));
      if (to === undefined) {
        return err(
          new TransitionError(`Illegal transition: ${from} --${on}-->`, { context: { from, on } }),
        );
      }
      return ok(to);
    },
    canTransition(from, on) {
      return lookup.has(key(from, on));
    },
    isTerminal(state) {
      return terminal.has(state);
    },
    legalTriggers(from) {
      return [...(outgoing.get(from) ?? [])];
    },
    hasState(state): state is S {
      return states.has(state);
    },
  };

  return Object.freeze(machine);
}
