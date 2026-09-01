/**
 * THE DASHBOARD SHOWS THE ALBUM'S ACTUAL FRONT COVER.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 *
 * The shelf already drew each album through `CoverDesignFromConfig` — the same component the
 * builder, the in-app preview, review mode and the printer-ready cover export draw through — so
 * there was never a second visual representation to drift. What it was missing was the ARTWORK:
 * `albumCoverFace` hardcoded `imageUrl={null}` (documented as avoiding an N+1), so an album whose
 * front is a photograph rendered as a bare background with its title on it, and a placed sticker
 * rendered as nothing at all.
 *
 * ── THE FIX, AND WHAT THESE TESTS PROTECT ──────────────────────────────────────────────────
 *
 * The artwork is resolved server-side through `resolveCoverFrontKeys`, a BATCHED version of the
 * canonical `resolveCoverImageKeys` — three queries for the whole shelf instead of two per album.
 * Two resolvers means two chances to disagree about which image a cover uses, so the first suite
 * below runs the identical fixtures through BOTH and asserts they answer identically.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { resolveCoverFrontKeys, resolveCoverImageKeys } from '@/lib/albums/cover';
import { DEFAULT_COVER_CONFIG, type CoverConfig } from '@/lib/builder/cover';
import { albumCoverFace } from '@/components/album-cover';

const ALBUM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALBUM2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTO = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '99999999-9999-4999-8999-999999999999';

type PhotoRow = { id: string; album_id: string; status: string; thumb_key: string | null; sanitized_key: string | null };
type TemplateRow = { id: string; image_key: string | null };

/**
 * A minimal PostgREST-shaped stub over two in-memory tables, supporting exactly the query shapes
 * both resolvers build (`select` → chained `eq`/`in` → `maybeSingle` or await). Deliberately small:
 * it exists to compare the two resolvers against each other, not to reimplement Supabase.
 */
function stubClient(photos: PhotoRow[], templates: TemplateRow[]) {
  let queries = 0;
  const api = {
    queryCount: () => queries,
    from(table: string) {
      queries += 1;
      let rows: Record<string, unknown>[] = table === 'photos' ? [...photos] : [...templates];
      const chain = {
        select: () => chain,
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => r[col] === val);
          return chain;
        },
        in(col: string, vals: unknown[]) {
          rows = rows.filter((r) => vals.includes(r[col] as never));
          return chain;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        // Awaiting the builder itself is the list form both resolvers use.
        then: (res: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: rows }).then(res),
      };
      return chain;
    },
  };
  return api as unknown as Parameters<typeof resolveCoverFrontKeys>[0] & { queryCount: () => number };
}

const album = (over: Partial<CoverConfig> = {}, coverTemplateId: string | null = null) => ({
  id: ALBUM,
  cover_template_id: coverTemplateId,
  cover_config: { ...DEFAULT_COVER_CONFIG, ...over } as unknown,
});

// ===============================================================================================
// 1 — the batched resolver agrees with the canonical one, case for case
// ===============================================================================================

describe('the shelf resolver answers the canonical priority chain', () => {
  const PHOTOS: PhotoRow[] = [
    { id: PHOTO, album_id: ALBUM, status: 'ready', thumb_key: 'u/thumb.jpg', sanitized_key: 'u/full.jpg' },
  ];
  const TEMPLATES: TemplateRow[] = [{ id: TEMPLATE, image_key: 'covers/art.png' }];

  const cases: [string, ReturnType<typeof album>][] = [
    ['a cover PHOTO wins over everything', album({ photoId: PHOTO }, TEMPLATE)],
    ['a TEMPLATE is used when there is no photo and no background', album({}, TEMPLATE)],
    ['a chosen BACKGROUND outranks a leftover template id', album({ background: { kind: 'color', value: 'sand' } }, TEMPLATE)],
    ['a pristine album resolves to the DEFAULT and no artwork', album()],
  ];

  it.each(cases)('%s', async (_label, a) => {
    const single = await resolveCoverImageKeys(stubClient(PHOTOS, TEMPLATES), a);
    const batched = (await resolveCoverFrontKeys(stubClient(PHOTOS, TEMPLATES), [a])).get(ALBUM);
    expect(batched?.kind).toBe(single.front.kind);
    // The only intentional difference: the shelf prefers the ~400px thumbnail over the print master.
    if (single.front.key === 'u/full.jpg') expect(batched?.key).toBe('u/thumb.jpg');
    else expect(batched?.key).toBe(single.front.key);
  });

  it('prefers the thumbnail, and falls back to the master when there is none', async () => {
    const noThumb: PhotoRow[] = [{ ...PHOTOS[0], thumb_key: null }];
    const r = await resolveCoverFrontKeys(stubClient(noThumb, TEMPLATES), [album({ photoId: PHOTO })]);
    expect(r.get(ALBUM)?.key).toBe('u/full.jpg');
  });

  it('a cover photo that is not READY resolves to no artwork rather than a broken image', async () => {
    const pending: PhotoRow[] = [{ ...PHOTOS[0], status: 'pending' }];
    const r = await resolveCoverFrontKeys(stubClient(pending, TEMPLATES), [album({ photoId: PHOTO })]);
    expect(r.get(ALBUM)).toEqual({ kind: 'photo', key: null });
  });

  it('a cover photo belonging to ANOTHER album never resolves', async () => {
    // The batched read is scoped by album_id as well as by RLS, so a forged id cannot borrow
    // another album's photo into this shelf card.
    const foreign: PhotoRow[] = [{ ...PHOTOS[0], album_id: ALBUM2 }];
    const r = await resolveCoverFrontKeys(stubClient(foreign, TEMPLATES), [album({ photoId: PHOTO })]);
    expect(r.get(ALBUM)?.key).toBeNull();
  });

  it('is a FIXED number of queries whatever the shelf holds — not an N+1', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `album-${i}`,
      cover_template_id: TEMPLATE,
      cover_config: { ...DEFAULT_COVER_CONFIG, photoId: i % 2 === 0 ? PHOTO : null } as unknown,
    }));
    const c = stubClient(PHOTOS, TEMPLATES);
    await resolveCoverFrontKeys(c, many);
    expect(c.queryCount()).toBeLessThanOrEqual(2);
  });

  it('resolves nothing, and asks nothing, for an empty shelf', async () => {
    const c = stubClient(PHOTOS, TEMPLATES);
    expect((await resolveCoverFrontKeys(c, [])).size).toBe(0);
    expect(c.queryCount()).toBe(0);
  });
});

// ===============================================================================================
// 2 — the shared face helper actually draws it
// ===============================================================================================

describe('albumCoverFace draws the resolved artwork', () => {
  it('renders the cover photo when one is supplied', () => {
    const html = renderToStaticMarkup(
      albumCoverFace({ ...DEFAULT_COVER_CONFIG, photoId: PHOTO }, 'Coorg', 'https://r2.example/thumb.jpg')!,
    );
    expect(html).toContain('https://r2.example/thumb.jpg');
  });

  it('still renders background + text with no artwork — the CSS-only cover is unchanged', () => {
    const html = renderToStaticMarkup(
      albumCoverFace({ ...DEFAULT_COVER_CONFIG, background: { kind: 'color', value: 'sand' } }, 'Coorg', null)!,
    );
    expect(html).toContain('Coorg');
    expect(html).not.toContain('<img');
  });

  it('renders a sticker placed on the cover when its URL is resolved', () => {
    const cover: CoverConfig = {
      ...DEFAULT_COVER_CONFIG,
      stickers: [{ id: 's1', stickerId: TEMPLATE, x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0, opacity: 1 }],
    };
    const html = renderToStaticMarkup(
      albumCoverFace(cover, 'Coorg', null, (id) => (id === TEMPLATE ? 'https://r2.example/sticker.png' : undefined))!,
    );
    expect(html).toContain('https://r2.example/sticker.png');
  });

  it('an album that has NEVER been designed still gets the bound-book fallback, not an invented cover', () => {
    // `null` config stays null — normalising it here would make a pristine album look designed.
    expect(albumCoverFace(null, 'Coorg', 'https://r2.example/thumb.jpg')).toBeUndefined();
  });
});

// ===============================================================================================
// 3 — the page is wired to it, and cannot drift back
// ===============================================================================================

describe('the dashboard is wired to the real cover', () => {
  const read = (p: string) => readFileSync(resolvePath(__dirname, '..', p), 'utf8');

  it('resolves artwork + stickers server-side and hands them to the shelf', () => {
    const page = read('src/app/(app)/dashboard/page.tsx');
    expect(page).toContain('resolveCoverFrontKeys');
    expect(page).toContain('resolveStickerUrls');
    expect(page).toContain('coverImageUrl');
    // `cover_template_id` has to ride along on the existing album read for the chain to resolve.
    expect(page).toContain('cover_config, cover_template_id');
  });

  it('the shelf passes them into the SHARED cover component — no second representation', () => {
    const library = read('src/app/(app)/dashboard/_library.tsx');
    expect(library).toContain('albumCoverFace(album.cover, album.title, album.coverImageUrl, stickerUrlFor)');
    // The shelf renders the album's own config; it never re-derives a cover of its own.
    expect(library).not.toContain('normalizeCoverConfig');
  });

  it('the hardcoded `imageUrl={null}` is gone from the shared helper', () => {
    const helper = read('src/components/album-cover.tsx');
    expect(helper).not.toContain('imageUrl={null}');
    expect(helper).toContain('imageUrl: string | null = null');
  });

  it('the single-album detail page resolves it too, through the CANONICAL resolver', () => {
    const detail = read('src/app/(app)/albums/[id]/page.tsx');
    expect(detail).toContain('resolveCoverImageKeys');
    expect(detail).toContain('coverFrontUrl');
  });

  /**
   * STALENESS. The thumbnail is drawn from `albums.cover_config`, which is the row the builder's
   * `saveCoverDesign` writes — so re-opening an album, editing the cover and saving updates the
   * one source the shelf reads. There is no cached copy, no derived thumbnail file and no second
   * store that could hold an older version.
   */
  it('reads the album\'s CURRENT saved cover, with nothing cached in between', () => {
    const page = read('src/app/(app)/dashboard/page.tsx');
    expect(page).toContain("from('albums')");
    expect(page).not.toContain('unstable_cache');
    expect(page).not.toContain('revalidate =');
    const action = read('src/lib/actions/builder.ts');
    expect(action).toContain('cover_config: config');
  });
});
