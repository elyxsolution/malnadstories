/**
 * Centralized application-cache strategy (Phase 10D).
 *
 * The ONE place that defines what is cached, for how long, and under which tag — so cache
 * lifetimes and invalidation paths are obvious and consistent. We cache ONLY global,
 * non-user-specific, public/active data (published CMS content, the active layout-template
 * catalog). Per-user data (dashboard, orders, builder, support, …) is NEVER cached here —
 * that avoids any cross-user/stale-auth leakage by construction.
 *
 * Mechanism: framework-native `unstable_cache` keyed by these tags. A short `revalidate`
 * TTL is the time-based BACKSTOP; the authoritative refresh is `revalidateTag(tag)` called
 * from the admin write actions that change the underlying rows. So the worst-case staleness
 * if a tag bust is ever missed is one TTL, and the normal case is "instant on publish".
 *
 *   Tag                | Cached read                         | Invalidated by
 *   -------------------|-------------------------------------|-----------------------------------
 *   cms-public         | lib/cms/public.listPublished        | admin/cms.ts (save/status/bulk/dup)
 *   templates-active   | lib/templates/catalog.listActive…   | admin/templates.ts (save/status/dup)
 */

export const CACHE_TAGS = {
  cmsPublic: 'cms-public',
  templatesActive: 'templates-active',
  coverTemplatesActive: 'cover-templates-active',
  // Album Product catalog (0047) — global, slowly-changing, read on every create-album +
  // pricing-preview path. Busted by admin/products.ts on any product/price/preview write.
  productsActive: 'album-products-active',
} as const;

/** Time-based backstop TTLs in SECONDS (tag invalidation is the primary path). */
export const CACHE_TTL = {
  cmsPublic: 300, // public marketing/help content changes rarely
  templatesActive: 300, // the curated preset catalog changes rarely
  coverTemplatesActive: 300, // the curated cover-design catalog changes rarely
  productsActive: 300, // the physical product catalog changes rarely
} as const;
