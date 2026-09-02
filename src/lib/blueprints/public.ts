import 'server-only';
import { categoryLabel, type TemplateCategory } from '@/lib/templates/model';
import { listActiveBlueprints } from '@/lib/templates/catalog';
import { resolveStickerUrls } from '@/lib/stickers';
import type { CoverConfig } from '@/lib/builder/cover';

/**
 * THE PUBLIC-SAFE BLUEPRINT PROJECTION — the only shape that may cross into a public page.
 *
 * WHY A PROJECTION AND NOT THE CATALOG ROW. `listActiveBlueprints()` returns the full
 * `ActiveBlueprint`, which carries the blueprint's entire interior GEOMETRY plus operational
 * fields. None of that is secret in a dangerous sense, but none of it is any of a visitor's
 * business either, and shipping it would serialise the complete layout of every design into the
 * HTML of a page anyone can view. So the public surface takes a deliberate subset and the rest
 * simply never leaves the server.
 *
 * WHAT IS DELIBERATELY OMITTED, and why:
 *   · `blueprint` (blocks/geometry) — the design's actual construction. Not needed to show a cover.
 *   · `isDefault` / `sort`         — merchandising and operations signals for the admin, not copy.
 *   · `thumbKey` / `thumbUrl`      — the LEGACY interior-spread montage (Phase 0). A cover gallery
 *                                    must not show interiors, and omitting it means the public
 *                                    pages presign nothing at all: no R2 round trip per design.
 *   · `preview_token_hash` etc.    — never selected by the catalog in the first place.
 *
 * ANON CANNOT READ `layout_templates` (0032 revokes it, and the SELECT policy is `to
 * authenticated`), so there is no browser-side path to this data even in principle. It is read
 * server-side through the existing cached, service-role catalog — the established seam — and only
 * this projection is handed to a component.
 */
export type PublicBlueprint = {
  id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  /** Human label for the category, resolved once here so no component re-derives it. */
  categoryLabel: string;
  /** Physical leaves — the album size this design is built for. */
  pageCount: number;
  /** How many photos the design holds. */
  slotCount: number;
  featured: boolean;
  popular: boolean;
  pinned: boolean;
  isNew: boolean;
  /** The design's front cover. `null` when the design predates Phase 0 covers. */
  cover: CoverConfig | null;
};

/** A resolved set of designs plus the sticker URLs their covers need. */
export type PublicBlueprintSet = {
  blueprints: PublicBlueprint[];
  /** id → presigned URL, for stickers placed on the covers in this set. */
  stickerUrls: Record<string, string>;
};

const EMPTY: PublicBlueprintSet = { blueprints: [], stickerUrls: {} };

/** Project one catalog row onto the public shape. Pure. */
function toPublic(b: Awaited<ReturnType<typeof listActiveBlueprints>>[number]): PublicBlueprint {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    category: b.category,
    categoryLabel: categoryLabel(b.category),
    pageCount: b.pageCount,
    slotCount: b.slotCount,
    featured: b.featured,
    popular: b.popular,
    pinned: b.pinned,
    isNew: b.isNew,
    cover: b.blueprint.cover ?? null,
  };
}

/**
 * Resolve the sticker URLs for a set of covers — ONE call for the whole page, never one per card.
 * Best-effort: stickers are decoration, and a failure here must not cost the page its designs.
 */
async function stickersFor(blueprints: PublicBlueprint[]): Promise<Record<string, string>> {
  const ids = blueprints.flatMap((b) => (b.cover ? b.cover.stickers.map((s) => s.stickerId) : []));
  if (ids.length === 0) return {};
  try {
    return await resolveStickerUrls(ids);
  } catch (e) {
    console.warn('[blueprints/public] sticker resolution failed — covers render without them', e);
    return {};
  }
}

/**
 * THE WHOLE ACTIVE CATALOGUE, public-safe — the Stories gallery's source.
 *
 * NEVER THROWS. A public marketing page must not 500 because a catalog read failed; it shows its
 * empty state instead. And it must never invent designs to fill the gap — see the CMS note in
 * `resolveBlueprintRefs`.
 */
export async function listPublicBlueprints(): Promise<PublicBlueprintSet> {
  try {
    const rows = await listActiveBlueprints();
    const blueprints = rows.map(toPublic);
    return { blueprints, stickerUrls: await stickersFor(blueprints) };
  } catch (e) {
    console.error('[blueprints/public] catalogue read failed', e);
    return EMPTY;
  }
}

/**
 * RESOLVE AN EXPLICIT, ORDERED LIST OF DESIGN IDS — what a CMS placement names.
 *
 * THE CMS'S ORDER IS THE ORDER. The catalog returns rows in merchandising order
 * (pinned → featured → sort), which is the right default for browsing and the WRONG answer here:
 * an editor who arranged four designs on the homepage expects to see them in that arrangement.
 * Merchandising flags remain available on each row as secondary signals, but they never re-sort an
 * explicit selection.
 *
 * AN UNRESOLVABLE ID IS SKIPPED, SILENTLY AND SAFELY. A design that has since been deactivated,
 * archived or deleted simply is not in the active catalogue, so it drops out of the result. That
 * is the correct behaviour for a public page: one stale reference must not empty the shelf, break
 * the layout, or surface a database error. What it must NEVER do is fall back to inventing
 * designs — the CMS layer has a fabricated-content fallback for FAQ/testimonial copy
 * (`lib/cms/public.ts`), and nothing here is allowed to work that way. A design that does not
 * exist is never advertised.
 */
export async function resolveBlueprintRefs(ids: readonly string[]): Promise<PublicBlueprintSet> {
  if (ids.length === 0) return EMPTY;
  try {
    const rows = await listActiveBlueprints();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const blueprints: PublicBlueprint[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue; // an editor listing one design twice gets it once
      seen.add(id);
      const row = byId.get(id);
      if (row) blueprints.push(toPublic(row));
    }
    return { blueprints, stickerUrls: await stickersFor(blueprints) };
  } catch (e) {
    console.error('[blueprints/public] reference resolution failed', e);
    return EMPTY;
  }
}

/**
 * The distinct categories present in a set, in catalog order — the Stories filter bar.
 * Derived from the DATA rather than from the enum, so a category with no active designs never
 * shows up as an empty filter.
 */
export function categoriesIn(blueprints: readonly PublicBlueprint[]): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const b of blueprints) if (!seen.has(b.category)) seen.set(b.category, b.categoryLabel);
  return Array.from(seen, ([key, label]) => ({ key, label }));
}
