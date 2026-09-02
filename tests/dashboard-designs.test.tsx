/**
 * THE DASHBOARD'S CREATION AREA AND ITS CURATED DESIGN SHELF.
 *
 * Two promises, both easy to break quietly:
 *
 *   · a customer with NO albums must arrive at an obvious invitation to make one — the creation
 *     area used to render only when a draft existed, so the person with the most to gain from it
 *     was the one person who never saw it;
 *   · the design shelf is ADMINISTERED, not authored here. No id, no default selection, no
 *     re-sorting, and — the one that matters most — nothing invented when nothing is configured.
 *
 * Both are asserted by RENDERING the real `Library` with real state: no albums, one draft, and a
 * placement with designs / without. Only framework boundaries are stubbed.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Source with comments stripped — these files explain themselves at length. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('@/lib/actions/albums', () => ({ deleteAlbum: async () => ({ ok: true }) }));

// Static imports are safe: Vitest hoists every vi.mock() above them.
import Library, { type LibraryAlbum } from '@/app/(app)/dashboard/_library';
import type { BlueprintPlacement } from '@/lib/cms/blueprint-placement';
import type { PublicBlueprint } from '@/lib/blueprints/public';
import { DASHBOARD_BLUEPRINTS_SLUG, HOME_BLUEPRINTS_SLUG, blueprintRefsFrom } from '@/lib/cms/blueprint-refs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const design = (id: string, name: string): PublicBlueprint => ({
  id,
  name,
  description: null,
  category: 'story',
  categoryLabel: 'Story',
  pageCount: 24,
  slotCount: 48,
  featured: false,
  popular: false,
  pinned: false,
  isNew: false,
  cover: null,
});

const placement = (blueprints: PublicBlueprint[]): BlueprintPlacement => ({
  heading: null,
  subheading: null,
  ctaLabel: null,
  ctaLink: null,
  set: { blueprints, stickerUrls: {} },
});

const album = (over: Partial<LibraryAlbum> = {}): LibraryAlbum =>
  ({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Coorg, in the rain',
    size: 24,
    status: 'draft',
    updatedAt: '2026-09-01T10:00:00.000Z',
    purchase: null,
    cover: null,
    coverImageUrl: null,
    ...over,
  }) as LibraryAlbum;

function render(albums: LibraryAlbum[], designs?: BlueprintPlacement) {
  const html = renderToStaticMarkup(React.createElement(Library, { albums, designs }));
  const hrefs = Array.from(html.matchAll(/href="([^"]*)"/g)).map((m) => m[1]);
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, hrefs, text };
}

// ── A NEW CUSTOMER ───────────────────────────────────────────────────────────────────────────

describe('a customer with no albums', () => {
  it('is invited to create one, prominently', () => {
    const { text, hrefs } = render([]);
    expect(text).toContain('New album');
    expect(text).toContain('Begin a new chapter');
    expect(hrefs).toContain('/albums/new');
  });

  it('is not shown a resume card, a placeholder album, or an invented count', () => {
    const { text } = render([]);
    expect(text).not.toContain('Pick up where you left off');
    expect(text).not.toContain('Resume building');
    expect(text).toContain('Your shelf is waiting for its first story.');
    // No fabricated story count.
    expect(text).not.toMatch(/\d+ stories on your shelf/);
  });

  it('is shown no designs when an administrator has configured none', () => {
    const { html, text } = render([], placement([]));
    expect(html).not.toContain('dashboard-designs-heading');
    expect(text).not.toContain('Use design');
    // And the same with no placement at all.
    expect(render([]).html).not.toContain('dashboard-designs-heading');
  });

  it('uses the EXISTING creation route — no second entry point', () => {
    const { hrefs } = render([]);
    for (const h of hrefs.filter((x) => x.startsWith('/albums/new'))) expect(h).toBe('/albums/new');
  });
});

// ── AN EXISTING CUSTOMER ─────────────────────────────────────────────────────────────────────

describe('a customer with a draft in progress', () => {
  const albums = [album()];

  it('keeps Resume building, unchanged in content and destination', () => {
    const { text, hrefs } = render(albums);
    expect(text).toContain('Pick up where you left off');
    expect(text).toContain('Resume building');
    expect(text).toContain('Coorg, in the rain');
    expect(hrefs).toContain('/albums/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/build');
  });

  it('keeps New album beside it', () => {
    const { text, hrefs } = render(albums);
    expect(text).toContain('New album');
    expect(hrefs).toContain('/albums/new');
  });

  it('keeps the story shelf, the search and every filter', () => {
    const { html, text } = render(albums);
    expect(text).toContain('Your stories');
    expect(html).toContain('placeholder="Search destinations…"');
    expect(html).toContain('<select'); // the year filter
    for (const chip of ['In progress', 'Ready to order', 'Ordered', 'Delivered']) {
      expect(text).toContain(chip);
    }
  });

  it('still shows the shelf bookend that starts a new story', () => {
    const { text } = render(albums);
    expect(text).toContain('New story');
  });
});

// ── THE SHELF IS ADMINISTERED ────────────────────────────────────────────────────────────────

describe('the curated design shelf', () => {
  const three = placement([design(A, 'Monsoon Trail'), design(B, 'Coastline'), design(C, 'High Range')]);

  it('renders exactly the configured designs, in the editor’s order', () => {
    const { text, html } = render([], three);
    expect(html).toContain('dashboard-designs-heading');
    const order = Array.from(html.matchAll(/design=([0-9a-f-]{36})/g)).map((m) => m[1]);
    // Two links per card (cover + action), so each id appears twice, in order.
    expect(order).toEqual([A, A, B, B, C, C]);
    for (const name of ['Monsoon Trail', 'Coastline', 'High Range']) expect(text).toContain(name);
  });

  it('never re-sorts or truncates what the editor arranged', () => {
    const shelf = code(src('src/app/(app)/dashboard/_design-shelf.tsx'));
    for (const bad of ['.sort(', '.slice(', 'featured', 'popular', 'pinned']) {
      expect(shelf).not.toContain(bad);
    }
  });

  it('contains no blueprint id, and no id reaches the frontend from anywhere but the CMS', () => {
    for (const f of [
      'src/app/(app)/dashboard/_design-shelf.tsx',
      'src/app/(app)/dashboard/_library.tsx',
      'src/app/(app)/dashboard/page.tsx',
    ]) {
      expect(src(f)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });

  it('offers Use design on every card, through the EXISTING blueprint entry point', () => {
    const { html, text } = render([], three);
    expect(text.match(/Use design/g)?.length).toBe(3);
    // The one href builder the public gallery and the home shelf already use.
    expect(src('src/app/(app)/dashboard/_design-shelf.tsx')).toContain(
      "import { designHref } from '@/components/public/blueprint-tile'",
    );
    // The shelf's own links only — the creation card is a bare /albums/new and is not one.
    const designLinks = Array.from(html.matchAll(/href="(\/albums\/new\?design=[^"]*)"/g)).map((m) => m[1]);
    expect(designLinks.length).toBe(6); // a cover link and an action link, per design
    for (const h of designLinks) expect(h).toMatch(/^\/albums\/new\?design=[0-9a-f-]{36}$/);
  });

  it('labels each action for screen readers and nests no interactive elements', () => {
    const { html } = render([], three);
    expect(html).toContain('aria-label="Use the Monsoon Trail design"');
    /*
     * The cover link and the action link are SIBLINGS — an anchor inside an anchor is invalid
     * HTML and a keyboard trap. Scanned rather than regexed: walk the shelf's tags and assert the
     * anchor depth never exceeds one.
     */
    const shelfHtml = html.slice(html.indexOf('dashboard-designs-heading'));
    let depth = 0;
    let maxDepth = 0;
    for (const tag of shelfHtml.match(/<\/?a\b[^>]*>/g) ?? []) {
      depth += tag.startsWith('</') ? -1 : 1;
      maxDepth = Math.max(maxDepth, depth);
    }
    expect(maxDepth).toBe(1);
    expect(depth).toBe(0); // every anchor closed
  });

  it('draws the blueprint’s FRONT COVER, never the retired interior montage', () => {
    const shelf = src('src/app/(app)/dashboard/_design-shelf.tsx');
    expect(shelf).toContain("import BlueprintCover from '@/components/blueprint-cover'");
    for (const bad of ['thumbUrl', 'thumbKey', 'montage', 'blocks']) {
      expect(code(shelf)).not.toContain(bad);
    }
  });

  it('falls back to the typographic stand-in for a design with no cover — never an invented one', () => {
    const { text } = render([], placement([design(A, 'Monsoon Trail')]));
    expect(text).toContain('Monsoon Trail');
    expect(text).toContain('Story');
  });

  it('links on to the full gallery rather than becoming it', () => {
    const { hrefs, text } = render([], three);
    expect(hrefs).toContain('/stories');
    expect(text).toContain('All designs');
  });

  it('adds no touch handler that could swallow a vertical scroll', () => {
    const shelf = code(src('src/app/(app)/dashboard/_design-shelf.tsx'));
    for (const bad of ['onTouchStart', 'onTouchMove', 'onPointerDown', 'setPointerCapture', 'touch-action', 'overflow-x']) {
      expect(shelf).not.toContain(bad);
    }
    // A server component: no client code at all on this shelf.
    expect(src('src/app/(app)/dashboard/_design-shelf.tsx')).not.toContain("'use client'");
  });

  it('uses the existing motion utilities only', () => {
    const shelf = src('src/app/(app)/dashboard/_design-shelf.tsx');
    expect(shelf).toContain('ms-lift'); // the shared cover-lift rule, which reduced motion disables
    expect(shelf).toContain('ease-glide');
    const pkg = JSON.parse(src('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['framer-motion']).toBeUndefined();
  });
});

// ── THE CMS MECHANISM ────────────────────────────────────────────────────────────────────────

describe('the placement reuses the Phase 1 CMS mechanism', () => {
  it('is a second SLUG on the generic loader — not a second CMS', () => {
    expect(DASHBOARD_BLUEPRINTS_SLUG).toBe('dashboard-featured-designs');
    expect(DASHBOARD_BLUEPRINTS_SLUG).not.toBe(HOME_BLUEPRINTS_SLUG);
    const page = src('src/app/(app)/dashboard/page.tsx');
    expect(page).toContain('loadBlueprintPlacement(DASHBOARD_BLUEPRINTS_SLUG)');
    // The loader, the metadata key, the parser and the resolver are the existing ones.
    expect(src('src/lib/cms/blueprint-placement.ts')).toContain('blueprintRefsFrom(row.metadata)');
    expect(src('src/lib/cms/blueprint-placement.ts')).toContain('resolveBlueprintRefs(ids)');
  });

  it('stores the selection the same way Home does, and reads it with the same parser', () => {
    expect(blueprintRefsFrom({ blueprintIds: [B, A] })).toEqual([B, A]); // order preserved
    expect(blueprintRefsFrom({ blueprintIds: [A, 'nope', 42, null, A] })).toEqual([A]); // junk dropped
    expect(blueprintRefsFrom(undefined)).toEqual([]);
  });

  it('needs no admin change — the picker is driven by the field kind, not the slug', () => {
    const editor = src('src/app/admin/cms/content/_editor.tsx');
    expect(editor).toContain("f.kind === 'blueprints'");
    expect(editor).toContain('<BlueprintPickerField');
    // Nothing in the CMS branches on which page a section is for.
    expect(code(editor)).not.toContain('dashboard-featured-designs');
  });

  it('inherits the existing cache tags and invalidation — no second cache', () => {
    const publicCms = src('src/lib/cms/public.ts');
    const catalog = src('src/lib/templates/catalog.ts');
    expect(publicCms).toContain('cmsPublic');
    expect(catalog).toContain('templatesActive');
    // The dashboard adds no cache of its own.
    expect(src('src/app/(app)/dashboard/page.tsx')).not.toContain('unstable_cache');
  });

  it('adds no CMS field, type or migration', () => {
    const model = src('src/lib/cms/model.ts');
    expect(model).toContain('homepage_section');
    // The metadata key is still the single generic one.
    expect(src('src/lib/cms/blueprint-refs.ts')).toContain("BLUEPRINT_REF_KEY = 'blueprintIds'");
  });
});

// ── NOTHING ELSE MOVED ───────────────────────────────────────────────────────────────────────

describe('scope', () => {
  it('leaves /stories as the full gallery', () => {
    const stories = src('src/app/stories/page.tsx');
    expect(stories).toContain('listPublicBlueprints()');
    expect(stories).not.toContain('DASHBOARD_BLUEPRINTS_SLUG');
  });

  it('leaves orders untouched and reachable from the rail', () => {
    expect(src('src/components/customer-shell.tsx')).toContain("href: '/orders'");
    // The dashboard never rendered an orders section, and still does not.
    expect(code(src('src/app/(app)/dashboard/_library.tsx'))).not.toContain('/orders');
  });

  it('leaves the album read, the purchase signal and the cover resolution as they were', () => {
    const page = src('src/app/(app)/dashboard/page.tsx');
    expect(page).toContain('resolveCoverFrontKeys(supabase, userAlbums)');
    expect(page).toContain("from('order_items')");
    expect(page).toContain('PAID_STATES');
  });
});
