/**
 * The consistent PROCESSOR LIFECYCLE every SDK-built processor runs, in order. The base
 * processor drives these phases uniformly (validate inputs → execute the transform → finalize
 * by checking outputs), emitting a progress update at each boundary, so every future processor
 * gets the same shape of telemetry and the same failure semantics for free.
 *
 * The phases describe WORK, not lifecycle state: a processor never renders or generates anything
 * in the SDK — it validates, transforms Artifacts, and produces Artifacts.
 */
export type ProcessorPhase = 'validate' | 'execute' | 'finalize';

export const PROCESSOR_PHASES: readonly ProcessorPhase[] = ['validate', 'execute', 'finalize'];
