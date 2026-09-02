/**
 * PHASE 0 — THE BLUEPRINT OWNS THE DESIGN.
 *
 * Three separate design products (Blueprint · Cover Design · Cover Artwork) became one. What that
 * consolidation must never do is change an album that already exists, so the assertions below are
 * split accordingly:
 *
 *   · the blueprint can now CARRY a cover, and an older blueprint that carries none still loads;
 *   · the cover survives the draft-album ROUND TRIP, which used to discard it silently;
 *   · an album takes a SNAPSHOT, so editing the blueprint afterwards cannot reach back into it;
 *   · album state (photo ids / image edits) can never be stored ON a blueprint, because a
 *     blueprint is global and a photo id names one customer's private upload;
 *   · the legacy `cover_template_id` chain still resolves, on every surface, unchanged.
 *
 * Pure: no database, no network, no fixtures — the same contract as the rest of this suite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BLUEPRINT_VERSION,
  blueprintCoverFromConfig,
  blueprintFromBlocks,
  normalizeBlueprint,
  type Blueprint,
} from '@/lib/builder/blueprint';
import { DEFAULT_COVER_CONFIG, normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { applyCoverTemplateToAlbum } from '@/lib/cover-templates/model';
import { BlueprintSchema } from '@/lib/validations';
import { classifyCover } from '@/lib/albums/cover';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Source with comments stripped. These files explain their own design at length, so a naive
 * substring search hits the PROSE describing what was removed and reports the opposite of the
 * truth. Where an assertion is about what the code DOES, it runs against this.
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A real sticker id — the schema requires a UUID, because a sticker is a catalog row. */
const STICKER_ID = '11111111-2222-4333-8444-555555555555';

/** A blueprint block, minimal but valid. */
const block = () => ({
  key: 'k',
  template: 'single-pair' as const,
  photoIds: [] as (string | null)[],
  caption: '',
  overlays: [],
  texts: [],
  qrs: [],
  stickers: [],
  background: null,
});

/** A cover a designer would actually author: colour, words, a sticker. */
const designedCover = (): CoverConfig => ({
  ...structuredClone(DEFAULT_COVER_CONFIG),
  subtitle: 'A week in the Ghats',
  color: '#112233',
  background: { kind: 'color', value: '#0f2e22' } as CoverConfig['background'],
  stickers: [{ id: 's1', stickerId: STICKER_ID, x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0, opacity: 1 }] as CoverConfig['stickers'],
});

describe('Blueprint parsing — a cover is optional and additive', () => {
  it('a blueprint with NO cover still loads, and stays cover-less', () => {
    const legacy = { version: 1, blocks: [{ template: 'single-pair', overlaySlots: [] }] };
    const bp = normalizeBlueprint(legacy);
    expect(bp).not.toBeNull();
    expect(bp!.blocks).toHaveLength(1);
    // Absent must stay absent — inventing a default here would give every legacy design a cover
    // it was never authored with.
    expect(bp!.cover).toBeUndefined();
    expect('cover' in bp!).toBe(false);
  });

  it('a blueprint WITH a cover loads it', () => {
    const bp = normalizeBlueprint({ version: 1, blocks: [{ template: 'single-pair' }], cover: designedCover() });
    expect(bp!.cover).toBeDefined();
    expect(bp!.cover!.subtitle).toBe('A week in the Ghats');
    expect(bp!.cover!.background).toEqual({ kind: 'color', value: '#0f2e22' });
  });

  it('the version is NOT bumped — an optional key is inside the existing contract', () => {
    expect(BLUEPRINT_VERSION).toBe(1);
    const withCover = blueprintFromBlocks([block()], designedCover());
    expect(withCover.version).toBe(1);
    // And the Zod gate accepts both shapes at version 1.
    expect(BlueprintSchema.safeParse(withCover).success).toBe(true);
    expect(BlueprintSchema.safeParse(blueprintFromBlocks([block()])).success).toBe(true);
  });

  it('a malformed cover does not take the whole blueprint down', () => {
    const bp = normalizeBlueprint({ version: 1, blocks: [{ template: 'single-pair' }], cover: 'not-an-object' });
    expect(bp).not.toBeNull();
    expect(bp!.cover).toBeUndefined();
  });
});

describe('A blueprint cover is DESIGN state, never ALBUM state', () => {
  it('strips the front photo, the back photo and both image edits', () => {
    const contaminated = {
      ...designedCover(),
      photoId: 'photo-belonging-to-a-customer',
      imageEdit: { zoom: 2 },
      back: {
        ...structuredClone(DEFAULT_COVER_CONFIG.back),
        photoId: 'another-customers-photo',
        imageEdit: { zoom: 3 },
      },
    };
    const cover = blueprintCoverFromConfig(contaminated);
    expect(cover.photoId).toBeNull();
    expect(cover.imageEdit).toBeNull();
    expect(cover.back.photoId).toBeNull();
    expect(cover.back.imageEdit).toBeNull();
  });

  it('keeps a back-cover overlay CONTAINER but clears the photo inside it', () => {
    const contaminated = {
      ...designedCover(),
      back: {
        ...structuredClone(DEFAULT_COVER_CONFIG.back),
        overlays: [{ id: 'o1', photoId: 'private-photo', x: 0.2, y: 0.3, w: 0.4, h: 0.5 }],
      },
    };
    const cover = blueprintCoverFromConfig(contaminated);
    expect(cover.back.overlays).toHaveLength(1);
    expect(cover.back.overlays[0].photoId).toBeNull();
    // The geometry is the design and must survive intact.
    expect(cover.back.overlays[0]).toMatchObject({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
  });

  it('KEEPS sticker ids — admin artwork resolved by id, not customer data', () => {
    const cover = blueprintCoverFromConfig(designedCover());
    expect(cover.stickers.map((s) => s.stickerId)).toEqual([STICKER_ID]);
  });

  it('sanitises on the way OUT too, so a hand-edited row cannot smuggle a photo id through', () => {
    // Simulates SQL-edited jsonb that never passed through the authoring gate.
    const bp = normalizeBlueprint({
      version: 1,
      blocks: [{ template: 'single-pair' }],
      cover: { ...designedCover(), photoId: 'smuggled' },
    });
    expect(bp!.cover!.photoId).toBeNull();
  });

  it('never aliases the caller — the blueprint owns its own copy', () => {
    const source = designedCover();
    const cover = blueprintCoverFromConfig(source);
    source.subtitle = 'mutated after capture';
    expect(cover.subtitle).toBe('A week in the Ghats');
  });
});

describe('The draft-album ROUND TRIP preserves the cover', () => {
  /**
   * The bug this pins: `updateBlueprintFromAlbum` read only `album_pages`, so a cover an admin
   * designed in Blueprint Mode was thrown away on save. The round trip is
   * blueprint.cover → draft album cover_config → blueprint.cover.
   */
  it('cover → draft → save → cover, byte-for-byte', () => {
    const original = blueprintFromBlocks([block()], designedCover());

    // openBlueprintForEditing seeds the draft album's cover_config from the blueprint.
    const draftCoverConfig = normalizeBlueprint(original)!.cover;
    expect(draftCoverConfig).toBeDefined();

    // updateBlueprintFromAlbum captures the draft's cover_config back into the blueprint.
    const saved = blueprintFromBlocks([block()], draftCoverConfig);

    expect(saved.cover).toEqual(original.cover);
    expect(saved.cover!.background).toEqual({ kind: 'color', value: '#0f2e22' });
    expect(saved.cover!.stickers).toHaveLength(1);
  });

  it('a draft with NO cover_config saves a cover-less blueprint rather than an invented one', () => {
    expect(blueprintFromBlocks([block()], null).cover).toBeUndefined();
    expect(blueprintFromBlocks([block()], undefined).cover).toBeUndefined();
  });

  it('the two round-trip actions actually read and write the cover (source-level)', () => {
    const s = src('src/lib/actions/admin/templates.ts');
    // Seeded on open…
    expect(s).toMatch(/cover_config: normalized\.cover/);
    // …and read back on save, from the album row rather than only album_pages.
    expect(s).toMatch(/select\('id, user_id, blueprint_draft_of, cover_config'\)/);
    expect(s).toMatch(/blueprintFromBlocks\(blocks, draftCover\)/);
  });

  it('Blueprint Mode persists the cover BEFORE distilling it (source-level)', () => {
    // updateBlueprintFromAlbum re-reads the row, so a cover left in client state would be lost.
    const s = src('src/app/(app)/albums/[id]/build/_use-blueprint-mode.ts');
    expect(s).toContain('saveCoverDesign');
    expect(s.indexOf('saveCoverDesign(')).toBeLessThan(s.indexOf('updateBlueprintFromAlbum('));
  });
});

describe('An album takes a SNAPSHOT of the blueprint cover', () => {
  it('is a deep clone — later blueprint edits cannot reach the album', () => {
    const bp: Blueprint = blueprintFromBlocks([block()], designedCover());

    // Album creation / blueprint apply both go through applyCoverTemplateToAlbum.
    const albumCover = applyCoverTemplateToAlbum(bp.cover);
    expect(albumCover.subtitle).toBe('A week in the Ghats');

    // The admin now edits the blueprint's cover…
    bp.cover!.subtitle = 'Completely different';
    bp.cover!.background = { kind: 'color', value: '#ff0000' } as CoverConfig['background'];
    bp.cover!.stickers = [];

    // …and the album is untouched. This is the guarantee orders and printed books rely on.
    expect(albumCover.subtitle).toBe('A week in the Ghats');
    expect(albumCover.background).toEqual({ kind: 'color', value: '#0f2e22' });
    expect(albumCover.stickers).toHaveLength(1);
  });

  it('clears photo slots, so a design never arrives naming a photo the album does not own', () => {
    const albumCover = applyCoverTemplateToAlbum({ ...designedCover(), photoId: 'x', imageEdit: { zoom: 2 } });
    expect(albumCover.photoId).toBeNull();
    expect(albumCover.imageEdit).toBeNull();
  });

  it('creation and blueprint-apply BOTH snapshot rather than reference (source-level)', () => {
    const albums = src('src/lib/actions/albums.ts');
    expect(albums).toMatch(/applyCoverTemplateToAlbum\(bp\.blueprint\.cover\)/);
    // No album column ever points at a blueprint's cover.
    expect(albums).not.toMatch(/cover_blueprint_id|blueprint_cover_id/);

    const builder = src('src/lib/actions/builder.ts');
    expect(builder).toMatch(/applyCoverTemplateToAlbum\(bp\.blueprint\.cover\)/);
  });
});

describe('LEGACY albums are untouched', () => {
  const resolution = (over: Partial<{ activeTemplate: boolean; config: CoverConfig; title: string }> = {}) => ({
    activeTemplate: false,
    config: normalizeCoverConfig(structuredClone(DEFAULT_COVER_CONFIG)),
    title: 'T',
    ...over,
  });

  it('the four-way cover classification still answers exactly as before', () => {
    expect(classifyCover(resolution({ config: { ...normalizeCoverConfig(structuredClone(DEFAULT_COVER_CONFIG)), photoId: 'p' } }))).toBe('photo');
    expect(classifyCover(resolution({ activeTemplate: true }))).toBe('template');
    expect(classifyCover(resolution({ config: designedCover() }))).toBe('design');
    expect(classifyCover(resolution())).toBe('default');
  });

  it('the legacy artwork chain is still wired on every render surface (source-level)', () => {
    const cover = src('src/lib/albums/cover.ts');
    // The album → cover_templates → image_key lookup, in both the single and batched resolvers.
    expect(cover).toMatch(/from\('cover_templates'\)/);
    expect(cover).toMatch(/album\.cover_template_id/);
    expect(cover).toMatch(/kind: key \? 'template' : 'default'/);
  });

  it('the builder still round-trips cover_template_id, so an edit cannot blank a legacy cover', () => {
    const b = src('src/app/(app)/albums/[id]/build/_builder.tsx');
    expect(b).toMatch(/const \[coverId\] = useState<string \| null>\(initialCoverId\)/);
    expect(b).toMatch(/coverTemplateId: coverId/);
  });

  it('the legacy table and column are NOT dropped by any migration', () => {
    const files = ['drizzle/0023_photobook_model.sql'];
    for (const f of files) expect(src(f)).toMatch(/create table if not exists public\.cover_templates/);
    // Nothing in the schema module removed them either.
    const schema = src('src/db/schema.ts');
    expect(schema).toMatch(/coverTemplateId: uuid\('cover_template_id'\)/);
    expect(schema).toMatch(/export const coverTemplates = pgTable\('cover_templates'/);
  });
});

describe('The blueprint is REPRESENTED BY ITS FRONT COVER, not an interior montage', () => {
  it('the shared representation renders through the canonical cover renderer', () => {
    const s = src('src/components/blueprint-cover.tsx');
    expect(s).toContain('CoverDesignFromConfig');
    // No second renderer and no raster pipeline: it draws a component, never an image, and
    // reaches no object store. (Asserted on the CODE — the file's prose explains why.)
    expect(code(s)).not.toContain('<img');
    expect(code(s)).not.toContain('@/lib/r2');
    expect(code(s)).not.toContain('presignGet');
  });

  it('a blueprint with no cover renders nothing, so callers can show an honest empty state', async () => {
    const { BlueprintCover } = await import('@/components/blueprint-cover');
    expect(BlueprintCover({ cover: null, name: 'x' })).toBeNull();
    expect(BlueprintCover({ cover: undefined, name: 'x' })).toBeNull();
  });

  it('both catalogs prefer the live cover, with the old raster only as a fallback', () => {
    for (const [f, coverBranch, rasterBranch] of [
      ['src/app/admin/templates/_blueprints.tsx', 'r.cover ?', 'r.thumbUrl &&'],
      ['src/app/(app)/albums/new/_blueprint-picker.tsx', 'b.cover ?', 'b.thumbUrl ?'],
    ] as const) {
      const s = src(f);
      expect(s).toContain('BlueprintCover');
      // The cover branch must be evaluated BEFORE the legacy raster branch — a real cover always
      // wins, and the interior montage is only what a pre-Phase-0 blueprint falls back to.
      const coverAt = s.indexOf(coverBranch);
      const rasterAt = s.indexOf(rasterBranch);
      expect(coverAt).toBeGreaterThan(-1);
      expect(rasterAt).toBeGreaterThan(-1);
      expect(coverAt).toBeLessThan(rasterAt);
      // A book face, not the montage's landscape box.
      expect(s).toContain('aspect-[3/4]');
    }
  });
});

describe('Cover Design and Cover Artwork are no longer products', () => {
  const nav = src('src/app/admin/_nav.tsx');
  const caps = src('src/lib/auth/capabilities.ts');

  it('their admin navigation entries are gone', () => {
    expect(nav).not.toContain('/admin/cover-templates');
    expect(nav).not.toContain('/admin/covers');
    // The design catalog they are replaced by is still there.
    expect(nav).toContain('/admin/templates');
  });

  it('their routes have no capability mapping left, and the capability itself is retired', () => {
    expect(caps).not.toContain('cover:manage');
    expect(caps).toContain('template:edit');
  });

  it('the builder no longer offers either gallery', () => {
    const b = src('src/app/(app)/albums/[id]/build/_builder.tsx');
    expect(b).not.toContain("railTab === 'templates'");
    expect(b).not.toContain('CoverTemplatesPanel');
    // But the album's own cover tools remain.
    expect(b).toContain("railTab === 'backgrounds'");
  });
});
