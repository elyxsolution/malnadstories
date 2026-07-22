import { defineStateMachine } from './state-machine.js';

/** Album lifecycle states (Phase Plan Rec 13). `archived` is terminal. */
export type AlbumState =
  | 'draft'
  | 'building'
  | 'submitted'
  | 'processing'
  | 'needs_fix'
  | 'ready'
  | 'ordered'
  | 'manufacturing'
  | 'delivered'
  | 'archived';

/** Album lifecycle triggers. */
export type AlbumTrigger =
  | 'start_building'
  | 'abandon'
  | 'submit'
  | 'start_processing'
  | 'request_fix'
  | 'mark_ready'
  | 'resubmit'
  | 'place_order'
  | 'start_manufacturing'
  | 'deliver'
  | 'archive';

/** The album state machine: the authoritative set of legal album transitions. */
export const ALBUM_MACHINE = defineStateMachine<AlbumState, AlbumTrigger>({
  initial: 'draft',
  states: [
    'draft',
    'building',
    'submitted',
    'processing',
    'needs_fix',
    'ready',
    'ordered',
    'manufacturing',
    'delivered',
    'archived',
  ],
  terminal: ['archived'],
  transitions: [
    { from: 'draft', on: 'start_building', to: 'building' },
    { from: 'draft', on: 'abandon', to: 'archived' },
    { from: 'building', on: 'submit', to: 'submitted' },
    { from: 'submitted', on: 'start_processing', to: 'processing' },
    { from: 'processing', on: 'request_fix', to: 'needs_fix' },
    { from: 'processing', on: 'mark_ready', to: 'ready' },
    { from: 'needs_fix', on: 'resubmit', to: 'submitted' },
    { from: 'ready', on: 'place_order', to: 'ordered' },
    { from: 'ordered', on: 'start_manufacturing', to: 'manufacturing' },
    { from: 'manufacturing', on: 'deliver', to: 'delivered' },
    { from: 'delivered', on: 'archive', to: 'archived' },
  ],
});
