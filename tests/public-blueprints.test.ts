/**
 * PHASE 1 — THE PUBLIC DESIGN SURFACE.
 *
 * Three things have to hold for the public site to be both correct and safe:
 *
 *   · CMS placement is READ FROM DATA, never hardcoded, and a junk/absent selection degrades to
 *     "no section" rather than to invented designs;
 *   · the public projection carries the cover and NOT the interior geometry, because these pages
 *     are anonymous and `layout_templates` is not anon-readable;
 *   · the navigation is the agreed four destinations, with no Pricing.
 *
 * Pure — no database, no network. The resolver itself (`resolveBlueprintRefs`) reaches the
 * service-role catalog and is exercised by the source-level assertions plus the browser QA
 * recorded in the phase report, not here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BLUEPRINT_REF_KEY,
  HOME_BLUEPRINTS_SLUG,
  MAX_BLUEPRINT_REFS,
  blueprintRefsFrom,
  withBlueprintRefs,
} from '@/lib/cms/blueprint-refs';
import { categoriesIn, type PublicBlueprint } from '@/lib/blueprints/public';
import { CmsSaveSchema } from '@/lib/validations';
import { TYPE_CONFIG } from '@/lib/cms/model';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Source with comments stripped — these files describe what they removed, at length. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('CMS blueprint references — the placement mechanism', () => {
  it('reads an ordered list out of metadata', () => {
    expect(blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: [B, A, C] })).toEqual([B, A, C]);
  });

  it('preserves the EDITOR ORDER rather than sorting it', () => {
    // The catalogue's own order is merchandising order; a curated shelf is not.
    expect(blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: [C, A] })).toEqual([C, A]);
  });

  it('de-duplicates, so one design listed twice appears once', () => {
    expect(blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: [A, A, B] })).toEqual([A, B]);
  });

  it('drops anything that is not a uuid, rather than passing junk to a lookup', () => {
    expect(blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: [A, 'not-an-id', 42, null, '', B] })).toEqual([A, B]);
  });

  it('is total — every malformed metadata shape yields no selection, never a throw', () => {
    for (const bad of [undefined, null, 'string', 42, [], {}, { [BLUEPRINT_REF_KEY]: 'x' }, { [BLUEPRINT_REF_KEY]: null }]) {
      expect(blueprintRefsFrom(bad)).toEqual([]);
    }
  });

  it('bounds the list, so a paste cannot store an unbounded array', () => {
    const many = Array.from({ length: MAX_BLUEPRINT_REFS + 10 }, (_, i) =>
      `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    );
    expect(blueprintRefsFrom({ [BLUEPRINT_REF_KEY]: many })).toHaveLength(MAX_BLUEPRINT_REFS);
  });

  it('round-trips through the writer with the same normalisation', () => {
    const meta = withBlueprintRefs({ heading: 'Designs' }, [B, B, 'junk' as string, A]);
    expect(meta.heading).toBe('Designs');
    expect(blueprintRefsFrom(meta)).toEqual([B, A]);
  });
});

describe('The CMS accepts a design selection — and only that', () => {
  const base = { type: 'homepage_section' as const, title: 'Featured designs' };

  it('stores an id array in metadata', () => {
    const r = CmsSaveSchema.safeParse({ ...base, metadata: { [BLUEPRINT_REF_KEY]: [A, B] } });
    expect(r.success).toBe(true);
  });

  it('still stores the existing scalar metadata', () => {
    const r = CmsSaveSchema.safeParse({ ...base, metadata: { heading: 'x', cta_label: 'y' } });
    expect(r.success).toBe(true);
  });

  it('REFUSES an array of non-uuids — the widening admits references, not free-form arrays', () => {
    expect(CmsSaveSchema.safeParse({ ...base, metadata: { [BLUEPRINT_REF_KEY]: ['nope'] } }).success).toBe(false);
  });

  it('refuses an over-long selection', () => {
    const many = Array.from({ length: MAX_BLUEPRINT_REFS + 1 }, () => A);
    expect(CmsSaveSchema.safeParse({ ...base, metadata: { [BLUEPRINT_REF_KEY]: many } }).success).toBe(false);
  });

  it('the homepage section declares the field, so the editor renders the picker', () => {
    const field = TYPE_CONFIG.homepage_section.metaFields.find((f) => f.key === BLUEPRINT_REF_KEY);
    expect(field).toBeDefined();
    expect(field!.kind).toBe('blueprints');
  });
});

describe('NOTHING about placement is hardcoded in the frontend', () => {
  it('the home page resolves its shelf through the CMS, by slug', () => {
    const home = src('src/app/page.tsx');
    expect(home).toContain('loadBlueprintPlacement');
    expect(home).toContain('HOME_BLUEPRINTS_SLUG');
    // No literal uuid anywhere in the page.
    expect(code(home)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // And no local "featured designs" array standing in for a real selection.
    expect(code(home)).not.toMatch(/const\s+featuredBlueprints\s*=/);
  });

  it('the slug is a shared constant, not retyped per call site', () => {
    expect(HOME_BLUEPRINTS_SLUG).toBe('home-featured-designs');
  });

  it('an empty or unresolvable selection renders NO section — never a fallback selection', () => {
    const shelf = src('src/components/public/blueprint-shelf.tsx');
    expect(shelf).toMatch(/blueprints\.length === 0\) return null/);
    // The shelf must not reach for the catalogue on its own.
    expect(code(shelf)).not.toContain('listActiveBlueprints');
    expect(code(shelf)).not.toContain('listPublicBlueprints');
  });

  it('design placement cannot inherit the CMS fabricated-content fallback', () => {
    // The fallback in lib/cms/public.ts covers only these three types; homepage_section returns [].
    const cms = src('src/lib/cms/public.ts');
    expect(cms).toMatch(/if \(type === 'faq'\)/);
    expect(cms).toMatch(/if \(type === 'testimonial'\)/);
    expect(cms).toMatch(/if \(type === 'legacy_story'\)/);
    expect(cms).not.toMatch(/if \(type === 'homepage_section'\)/);
  });
});

describe('The public projection is safe to serialise to an anonymous visitor', () => {
  it('carries the cover and omits the interior geometry', () => {
    const pub = src('src/lib/blueprints/public.ts');
    expect(pub).toMatch(/cover: b\.blueprint\.cover \?\? null/);
    // The projection is built field-by-field; `blueprint` is never copied onto it.
    expect(code(pub)).not.toMatch(/blueprint: b\.blueprint/);
    expect(code(pub)).not.toMatch(/\.\.\.b,/);
  });

  it('omits operational fields a visitor has no use for', () => {
    const pub = code(src('src/lib/blueprints/public.ts'));
    for (const field of ['isDefault', 'thumbKey', 'thumbUrl', 'sort']) {
      expect(pub).not.toContain(`${field}:`);
    }
  });

  it('reads through the server-only cached catalogue, never a browser query', () => {
    const pub = src('src/lib/blueprints/public.ts');
    expect(pub).toMatch(/^import 'server-only';/m);
    expect(pub).toContain('listActiveBlueprints');
    expect(code(pub)).not.toContain('createBrowserClient');
  });

  it('derives filter categories from the DATA, so no empty filter is ever offered', () => {
    const set: PublicBlueprint[] = [
      { category: 'travel', categoryLabel: 'Travel' } as unknown as PublicBlueprint,
      { category: 'travel', categoryLabel: 'Travel' } as unknown as PublicBlueprint,
      { category: 'story', categoryLabel: 'Story' } as unknown as PublicBlueprint,
    ];
    expect(categoriesIn(set)).toEqual([
      { key: 'travel', label: 'Travel' },
      { key: 'story', label: 'Story' },
    ]);
    expect(categoriesIn([])).toEqual([]);
  });
});

describe('Public navigation', () => {
  const header = src('src/components/public-header.tsx');
  const footer = src('src/components/public-footer.tsx');

  it('is exactly Home / Stories / About / Contact & FAQ', () => {
    const labels = Array.from(header.matchAll(/label: '([^']+)'/g), (m) => m[1]);
    expect(labels).toEqual(['Home', 'Stories', 'About', 'Contact & FAQ']);
  });

  it('has no Pricing, in the header or the footer', () => {
    // Against the CODE, not the prose: both files explain in comments why Pricing was removed.
    expect(code(header)).not.toContain('/pricing');
    expect(code(footer)).not.toContain('/pricing');
    expect(code(header)).not.toMatch(/Pricing/);
    expect(code(footer)).not.toMatch(/Pricing/);
  });

  it('sends the brand mark to Home, never to a dashboard', () => {
    expect(header).toContain('aria-label="Malnad Stories — home"');
    expect(code(header)).not.toContain('/dashboard');
    expect(code(footer)).not.toContain('/dashboard');
  });

  it('every public destination the nav names actually exists as a route', () => {
    for (const p of ['src/app/page.tsx', 'src/app/stories/page.tsx', 'src/app/about/page.tsx', 'src/app/contact/page.tsx']) {
      expect(() => src(p)).not.toThrow();
    }
  });
});

describe('Motion is opt-out-able and never hides content', () => {
  it('reduced motion neutralises the reveal instead of leaving it transparent', () => {
    const css = src('src/app/globals.css');
    const block = css.slice(css.indexOf('[data-reveal]'));
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // The reduced-motion rule must force the element VISIBLE, not merely stop the transition.
    const reduced = block.slice(block.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/opacity:\s*1/);
    expect(reduced).toMatch(/transform:\s*none/);
  });

  it('the reveal animates only compositor properties', () => {
    const css = src('src/app/globals.css');
    const block = css.slice(css.indexOf('[data-reveal] {'), css.indexOf("[data-reveal='shown']"));
    expect(block).toMatch(/transition:\s*\n?\s*opacity/);
    expect(block).toContain('transform');
    for (const bad of ['height', 'width', 'margin', 'top:', 'left:']) expect(block).not.toContain(bad);
  });

  it('a no-JS reader is never left with an invisible page', () => {
    // The idle state (opacity 0) is server-rendered by design, so `scripting: none` must
    // neutralise it — otherwise content that JS never reveals is gone for good.
    const css = src('src/app/globals.css');
    const block = css.slice(css.indexOf('[data-reveal]'));
    expect(block).toMatch(/@media \(scripting: none\)/);
    const noScript = block.slice(block.indexOf('scripting: none'));
    expect(noScript.slice(0, 220)).toMatch(/opacity:\s*1/);
  });

  it('the reveal fires once and then disconnects — no ongoing scroll work', () => {
    const reveal = src('src/components/public/reveal.tsx');
    expect(reveal).toContain('io.disconnect()');
    expect(code(reveal)).not.toContain("addEventListener('scroll'");
  });
});

describe('Design tiles cannot capture a touch scroll', () => {
  it('the tile sets no drag, pointer-capture or touch-action behaviour', () => {
    const tile = code(src('src/components/public/blueprint-tile.tsx'));
    expect(tile).toContain('draggable={false}');
    for (const bad of ['onPointerDown', 'onTouchStart', 'onTouchMove', 'setPointerCapture', 'touch-action', 'onDragStart']) {
      expect(tile).not.toContain(bad);
    }
  });

  it('the gallery scrolls its filter row without touching the page scroll', () => {
    const gallery = src('src/components/public/blueprint-gallery.tsx');
    // Only the chip row is scrollable, and only horizontally.
    expect(gallery).toContain('overflow-x-auto');
    expect(code(gallery)).not.toContain('overflow-hidden"');
  });
});

describe('Phase 2 authentication was NOT implemented', () => {
  it('the Use Design CTA states its destination contract without building the auth flow', () => {
    const tile = src('src/components/public/blueprint-tile.tsx');
    expect(tile).toMatch(/\/albums\/new\?design=/);
    // No return-to plumbing, no auth state, no sign-in awareness in the public tile.
    const c = code(tile);
    for (const bad of ['next=', 'returnTo', 'getUser', 'useSession', 'signIn']) expect(c).not.toContain(bad);
  });

  it('the public header renders no auth state', () => {
    const c = code(src('src/components/public-header.tsx'));
    for (const bad of ['getUser', 'useSession', 'UserMenu', 'signOut', 'createBrowserClient']) {
      expect(c).not.toContain(bad);
    }
  });
});
