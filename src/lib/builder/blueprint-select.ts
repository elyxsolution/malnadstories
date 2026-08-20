/**
 * DETERMINISTIC AUTO-CREATE BLUEPRINT SELECTION — one rule, shared by the server action and the
 * creation wizard.
 *
 * The rule itself is unchanged and comes from 0045: use the admin's DEFAULT blueprint for the
 * album's page count; only when no default is set fall back to the closest capacity, taking the
 * FIRST such blueprint in catalog order (pinned/featured/sort) — never random. Auto Create must
 * be predictable and admin-controlled.
 *
 * WHY IT LIVES HERE. The rule was written twice: once in `autoSelectAndApplyBlueprint` (the
 * authority) and once inline in the wizard, which showed the customer which layout Auto Create
 * "will" use. Two copies of a deterministic choice is a divergence waiting to happen — and the
 * copies had in fact already drifted, because the wizard ran its tie-break over a list it had
 * re-sorted for display while the server ran it over catalog order. Phase 4 moves the actual
 * application client-side, so the two would have had to agree exactly; extracting the rule is
 * what makes that true by construction rather than by comment.
 *
 * PURE and structurally typed: no React, no I/O, no `server-only` import, so both a server action
 * and a client component can call it. Generic over the blueprint shape because the two callers
 * hold different projections of the same row.
 *
 * ORDER MATTERS. Pass the list in CATALOG order (as `listActiveBlueprints` returns it). The
 * closest-capacity tie-break resolves to the first match, so a display-sorted list would select
 * a different blueprint.
 */

/** The minimum shape the selection rule reads. Satisfied by ActiveBlueprint and the wizard's projection. */
export type SelectableBlueprint = {
  pageCount: number;
  slotCount: number;
  isDefault: boolean;
};

/** Blueprints usable for an album of exactly `pageCount` leaves, in the order supplied. */
export function blueprintsForPageCount<T extends SelectableBlueprint>(
  all: readonly T[],
  pageCount: number,
): T[] {
  return all.filter((b) => b.pageCount === pageCount);
}

/**
 * The blueprint Auto Create will apply, or null when none match.
 *
 * `photoCount` is the number of photos that will actually be placed — historically the count of
 * worker-ready photos, and from Phase 4 the count of photos with a reliable shape. It only ever
 * influences the no-default tie-break.
 */
export function selectAutoBlueprint<T extends SelectableBlueprint>(
  matching: readonly T[],
  photoCount: number,
): T | null {
  if (matching.length === 0) return null;
  const def = matching.find((b) => b.isDefault);
  if (def) return def;
  return matching.reduce(
    (best, b) => (Math.abs(b.slotCount - photoCount) < Math.abs(best.slotCount - photoCount) ? b : best),
    matching[0],
  );
}
