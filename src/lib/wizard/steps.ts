/**
 * THE single source of truth for the album-creation flow's steps.
 *
 * Before this module the step list existed twice — a four-entry `STEPS` array in
 * `albums/new/_wizard.tsx` and a second, independently-maintained four-entry array in
 * `albums/[id]/build/_header.tsx` whose fourth label had already drifted ("Create" vs
 * "Review"). Alongside them sat a hand-kept `ROMAN = ['I','II','III','IV']`, a
 * four-entry `continueLabel` array, and a scatter of `step === 2` / `go(2)` literals.
 * Changing the flow meant finding all of them.
 *
 * Everything now derives from `WIZARD_STEPS`. Add or remove an entry here and the
 * progress indicator, the labels, the bounds checks and the builder's header all follow.
 * Nothing else may hardcode a step count, a step index, or a step label.
 */

export const WIZARD_STEPS = [
  {
    key: 'details',
    label: 'Album Details',
    /** Shown under the label on wide screens — what this step is actually for. */
    hint: 'Choose your book and name it',
  },
  {
    key: 'build',
    label: 'Upload & Build',
    hint: 'Add photos, then create',
  },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];
export type WizardStepKey = WizardStep['key'];

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;
export const LAST_WIZARD_STEP = WIZARD_STEP_COUNT - 1;

/** Index of a step by key — so callers never write a bare integer. */
export function wizardStepIndex(key: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((s) => s.key === key);
}

/** Clamp an arbitrary number into the valid step range. */
export function clampWizardStep(n: number): number {
  return Math.min(Math.max(n, 0), LAST_WIZARD_STEP);
}
