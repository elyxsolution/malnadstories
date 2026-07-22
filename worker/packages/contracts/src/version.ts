import type { Brand } from './brand.js';

/** A semantic-version string (`MAJOR.MINOR.PATCH`), branded to prevent mix-ups. */
export type SemVer = Brand<string, 'SemVer'>;

/**
 * Version of the shared-contracts surface itself. Consumers may pin against it; a
 * breaking change to any exported contract bumps this (ADR-gated — Playbook §4.2.1).
 */
export const CONTRACTS_VERSION = '0.0.0';
