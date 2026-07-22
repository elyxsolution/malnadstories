import { defineStateMachine } from './state-machine.js';

/** Processing-run lifecycle states. `succeeded`/`failed`/`cancelled` are terminal. */
export type RunState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Run lifecycle triggers. */
export type RunTrigger = 'start' | 'succeed' | 'fail' | 'cancel';

/** The run state machine: the authoritative set of legal run transitions. */
export const RUN_MACHINE = defineStateMachine<RunState, RunTrigger>({
  initial: 'pending',
  states: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
  terminal: ['succeeded', 'failed', 'cancelled'],
  transitions: [
    { from: 'pending', on: 'start', to: 'running' },
    { from: 'pending', on: 'cancel', to: 'cancelled' },
    { from: 'running', on: 'succeed', to: 'succeeded' },
    { from: 'running', on: 'fail', to: 'failed' },
    { from: 'running', on: 'cancel', to: 'cancelled' },
  ],
});

/** Non-terminal run states — a run in one of these is "active" for INV-6 (one active run). */
export const ACTIVE_RUN_STATES: readonly RunState[] = ['pending', 'running'];

/** Whether a run state is active (non-terminal). Pure. */
export function isActiveRunState(state: RunState): boolean {
  return state === 'pending' || state === 'running';
}
