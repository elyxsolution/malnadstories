/**
 * CMS → BLUEPRINT REFERENCES — one generic concept, not a per-page feature.
 *
 * A CMS content row can name a list of designs in its `metadata`, under a single well-known key.
 * That is the whole mechanism. Home consumes it one way (a small curated shelf), Stories can
 * consume it another (curation on top of the full catalogue), and a future surface consumes it a
 * third — but there is exactly ONE storage shape, ONE parser, and ONE resolver
 * (`resolveBlueprintRefs`). There is deliberately no `HomeBlueprints` / `StoriesBlueprints` pair
 * with duplicated logic.
 *
 * NO MIGRATION. `content_pages.metadata` is `jsonb not null default '{}'` with no CHECK
 * constraint (0031), so a list of ids is already storable. Nothing about the CMS schema, its RLS,
 * its grants or its cache tag changed to support this.
 *
 * PURE — no I/O, no `server-only`. The admin editor (a Client Component) parses the same value
 * with the same function the server renders from, so the two cannot drift.
 */

/** The one metadata key that carries a design selection. */
export const BLUEPRINT_REF_KEY = 'blueprintIds';

/** The slug of the homepage section that curates the Home design shelf. */
export const HOME_BLUEPRINTS_SLUG = 'home-featured-designs';

/**
 * A conservative UUID shape check. The value is admin-authored, but it is still stored JSON that
 * a hand-edited row could carry anything into — and it is used as a lookup key. Filtering to
 * well-formed ids here means a junk entry is dropped at the boundary rather than travelling
 * through the resolver.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many designs one placement may name. Bounds an accidental paste, not a product rule. */
export const MAX_BLUEPRINT_REFS = 24;

/**
 * Read an ordered, de-duplicated list of design ids out of a CMS row's metadata.
 *
 * Tolerant by design: metadata is free-form jsonb, so a missing key, a null, a string, or an
 * array containing non-strings must all resolve to "no selection" rather than throwing. A public
 * page rendering nothing is a recoverable state; a public page crashing is not.
 */
export function blueprintRefsFrom(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as Record<string, unknown>)[BLUEPRINT_REF_KEY];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!UUID.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_BLUEPRINT_REFS) break;
  }
  return out;
}

/** Write a selection back into a metadata object, normalised the same way it is read. */
export function withBlueprintRefs<T extends Record<string, unknown>>(
  metadata: T,
  ids: readonly string[],
): T & Record<string, unknown> {
  return { ...metadata, [BLUEPRINT_REF_KEY]: blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: ids }) };
}
