import 'server-only';
import { listPublished } from '@/lib/cms/public';
import { blueprintRefsFrom } from '@/lib/cms/blueprint-refs';
import { resolveBlueprintRefs, type PublicBlueprintSet } from '@/lib/blueprints/public';

/**
 * A CMS-CURATED SET OF DESIGNS — the generic bridge between the CMS and the design catalogue.
 *
 * ONE loader serves every surface. Home asks for its section by slug; Stories (or anything later)
 * asks for its own by its own slug. There is no `HomeBlueprints` and no `StoriesBlueprints`, and
 * nothing downstream of this file knows which page it is rendering for.
 *
 * THE FRONTEND DOES NOT DECIDE WHICH DESIGNS ARE FEATURED. It reads a published
 * `homepage_section` row, takes the ids the editor put in its `metadata`, and resolves them in
 * that order. There is no hardcoded id and no "pick the first three from the catalogue" fallback
 * anywhere in the render path.
 *
 * ⚠️ THE FABRICATED-CONTENT HAZARD, AND WHY IT CANNOT REACH THIS. `fetchPublished` in
 * `lib/cms/public.ts` returns INVENTED rows when its query throws — a fake FAQ, a fake
 * testimonial, a fake story. That is pre-existing behaviour and out of Phase 1's scope to change,
 * but design placement must never inherit it. It cannot, for two independent reasons: the
 * fallback covers only `faq` / `testimonial` / `legacy_story` and returns `[]` for
 * `homepage_section`; and even a fabricated row would carry no `blueprintIds`, so
 * `blueprintRefsFrom` would yield `[]` and `resolveBlueprintRefs` would return nothing. A design
 * that does not exist can never be advertised. **Follow-up (not Phase 1): remove the fabricated
 * fallback from `fetchPublished` entirely — a DB blip currently shows visitors invented FAQ and
 * testimonial copy presented as real.**
 *
 * CACHING is inherited, not re-invented: `listPublished` is `unstable_cache`d under
 * `CACHE_TAGS.cmsPublic` and `listActiveBlueprints` under `CACHE_TAGS.templatesActive`. Publishing
 * a section busts the first; editing a design busts the second. Neither tag needed changing.
 */
export type BlueprintPlacement = {
  /** Editorial copy from the CMS row. Every field optional — the page supplies its own defaults. */
  heading: string | null;
  subheading: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  /** The resolved designs, in the editor's order, with their cover stickers. */
  set: PublicBlueprintSet;
};

const EMPTY: BlueprintPlacement = {
  heading: null,
  subheading: null,
  ctaLabel: null,
  ctaLink: null,
  set: { blueprints: [], stickerUrls: {} },
};

/** Read one string field out of CMS metadata, treating blank as absent. */
function metaText(metadata: Record<string, unknown>, key: string): string | null {
  const v = metadata[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Load the design placement published under `slug`.
 *
 * NEVER THROWS and never partially fails: an absent section, an unpublished one, one with no
 * selection, or a catalogue read that failed all produce the same empty result, and the calling
 * page decides what to render for it. A marketing page must degrade to showing less, never to a
 * stack trace.
 */
export async function loadBlueprintPlacement(slug: string): Promise<BlueprintPlacement> {
  try {
    const sections = await listPublished('homepage_section');
    const row = sections.find((s) => s.slug === slug);
    if (!row) return EMPTY;

    const ids = blueprintRefsFrom(row.metadata);
    const set = await resolveBlueprintRefs(ids);

    return {
      heading: metaText(row.metadata, 'heading') ?? row.title,
      subheading: metaText(row.metadata, 'subheading') ?? row.content,
      ctaLabel: metaText(row.metadata, 'cta_label'),
      ctaLink: metaText(row.metadata, 'cta_link'),
      set,
    };
  } catch (e) {
    console.error(`[cms/blueprint-placement] failed to load "${slug}"`, e);
    return EMPTY;
  }
}
