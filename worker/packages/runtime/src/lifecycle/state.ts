import { defineStateMachine } from '@workerv2/control-plane';

/**
 * Runtime lifecycle states. Reuses the generic `defineStateMachine` engine from the domain
 * package — a non-domain use of a generic mechanism (no domain behavior is introduced).
 */
export type RuntimeState = 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export type RuntimeTrigger =
  'begin_start' | 'complete_start' | 'begin_stop' | 'complete_stop' | 'fail';

/** The runtime lifecycle machine: `created → starting → running → stopping → stopped` (+ `failed`). */
export const RUNTIME_MACHINE = defineStateMachine<RuntimeState, RuntimeTrigger>({
  initial: 'created',
  states: ['created', 'starting', 'running', 'stopping', 'stopped', 'failed'],
  terminal: ['stopped', 'failed'],
  transitions: [
    { from: 'created', on: 'begin_start', to: 'starting' },
    { from: 'starting', on: 'complete_start', to: 'running' },
    { from: 'starting', on: 'fail', to: 'failed' },
    { from: 'running', on: 'begin_stop', to: 'stopping' },
    { from: 'stopping', on: 'complete_stop', to: 'stopped' },
    { from: 'stopping', on: 'fail', to: 'failed' },
  ],
});
