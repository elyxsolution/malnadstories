import { defineStateMachine } from './state-machine.js';

/** Asset lifecycle states (Phase Plan Rec 14). `deleted` is terminal. */
export type AssetState =
  'incoming' | 'verified' | 'canonical' | 'derivative' | 'referenced' | 'archived' | 'deleted';

/** Asset lifecycle triggers. */
export type AssetTrigger =
  'verify' | 'reject' | 'promote_canonical' | 'derive' | 'reference' | 'archive' | 'delete';

/** The asset state machine: the authoritative set of legal asset transitions. */
export const ASSET_MACHINE = defineStateMachine<AssetState, AssetTrigger>({
  initial: 'incoming',
  states: ['incoming', 'verified', 'canonical', 'derivative', 'referenced', 'archived', 'deleted'],
  terminal: ['deleted'],
  transitions: [
    { from: 'incoming', on: 'verify', to: 'verified' },
    { from: 'incoming', on: 'reject', to: 'deleted' },
    { from: 'verified', on: 'promote_canonical', to: 'canonical' },
    { from: 'canonical', on: 'derive', to: 'derivative' },
    { from: 'derivative', on: 'reference', to: 'referenced' },
    { from: 'referenced', on: 'archive', to: 'archived' },
    { from: 'archived', on: 'delete', to: 'deleted' },
  ],
});
