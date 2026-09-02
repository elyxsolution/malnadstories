/**
 * THE ALBUM-CREATION LAYOUT — three books beside three page counts, and one commit under both.
 *
 * The refinement this pins is easy to undo by accident, because every part of it is a class on
 * an element someone will eventually tidy:
 *
 *   · the two option stacks END LEVEL, which is what makes them read as one decision rather than
 *     two adjacent sections. They do it by SHARING ONE HEIGHT FLOOR, not by two numbers that
 *     happen to agree — so the assertion is that the constant reaches both cards;
 *   · the Continue button spans the book + page columns AND the gap between them, and stops
 *     short of the specification rail;
 *   · nothing was removed from a book card to buy the height back.
 *
 * Rendered with `react-dom/server`, so these are assertions about real markup. The pixel
 * alignment itself was measured in a browser (see the phase report) — jsdom has no layout engine
 * and this suite has no DOM, so a height in CSS is the closest thing to it that can be asserted
 * here, and the constant is what makes that height a single decision.
 */
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

// Static imports are safe: Vitest hoists every vi.mock() above them.
import StepDetails from '@/app/(app)/albums/new/_step-details';
import type { ProductOption } from '@/lib/products/catalog';

const ROOT = resolve(__dirname, '..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** Source with comments stripped — these files explain at length what they stopped doing. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const mk = (id: string, name: string, w: number, h: number, isDefault = false) =>
  ({
    id,
    name,
    widthCm: w,
    heightCm: h,
    isDefault,
    pageCounts: [24, 36, 48],
    coverPreviewUrl: null,
    previewUrls: [],
    startingPrice: 0,
  }) as unknown as ProductOption;

const PRODUCTS = [
  mk('a', 'Standard', 21, 29.7, true),
  mk('b', 'Premium', 25, 35),
  mk('c', 'Signature', 29.7, 42),
];

function renderWith(productId: string) {
  const html = renderToStaticMarkup(
    React.createElement(StepDetails, {
      albumProducts: PRODUCTS,
      albumProductId: productId,
      pageCount: 24,
      canContinue: true,
      creating: false,
      onContinue: () => {},
      onSelectProduct: () => {},
      onSelectPageCount: () => {},
    }),
  );
  return { html };
}

function render(opts: { pageCount?: number | null; creating?: boolean } = {}) {
  const html = renderToStaticMarkup(
    React.createElement(StepDetails, {
      albumProducts: PRODUCTS,
      albumProductId: 'a',
      pageCount: opts.pageCount === undefined ? 24 : opts.pageCount,
      canContinue: opts.pageCount !== null,
      creating: opts.creating ?? false,
      onContinue: () => {},
      onSelectProduct: () => {},
      onSelectPageCount: () => {},
    }),
  );
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&times;/g, '×')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { html, text };
}

// ── THE TWO STACKS END LEVEL ─────────────────────────────────────────────────────────────────

describe('the book and page stacks are one configuration area', () => {
  const select = src('src/app/(app)/albums/new/_product-select.tsx');

  it('share ONE height floor, declared once', () => {
    expect(select).toContain("const CARD_MIN_H = 'min-h-[");
    // Reaching both card types is the whole point of the constant existing.
    const uses = select.match(/\$\{CARD_MIN_H\}/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it('applies that floor to every option card in the rendered page', () => {
    const { html } = render();
    const floor = /const CARD_MIN_H = '(min-h-\[[^\]]+\])'/.exec(select)?.[1] ?? '';
    expect(floor).not.toBe('');
    // Three books + three page counts.
    expect(html.split(floor).length - 1).toBe(6);
  });

  it('no longer lets the thumbnail dictate the card height', () => {
    // It used to be `aspect-[3/2]`, so the card's height was a function of a width — which is
    // why the two columns could not be aligned without solving for one. (Against the CODE: the
    // file's own comment still names the ratio it stopped using.)
    expect(code(select)).not.toContain('aspect-[3/2]');
  });
});

// ── NOTHING WAS REMOVED TO BUY THE HEIGHT ────────────────────────────────────────────────────

describe('the book cards kept every fact they carried', () => {
  it('still names each book, its dimensions and its page options', () => {
    const { text } = render();
    for (const [name, dims] of [
      ['Standard', '21 × 29.7 cm'],
      ['Premium', '25 × 35 cm'],
      ['Signature', '29.7 × 42 cm'],
    ]) {
      expect(text).toContain(name);
      expect(text).toContain(dims);
    }
    expect(text.match(/24 · 36 · 48 pages/g)?.length).toBe(3);
  });

  it('keeps the selection indicator, the Popular badge and both metadata icons', () => {
    const { html } = render();
    expect(html).toContain('aria-pressed="true"'); // the selected book carries the tick
    // The Popular badge is the default book's, and it yields to the tick when that book is the
    // selected one — so it is asserted with a different book selected, which is when it shows.
    expect(renderWith('b').html).toContain('Popular');
    expect(html.match(/<svg/g)?.length).toBeGreaterThan(6); // ruler + layers on each card, etc.
  });

  it('states selection semantically, not only with a border colour', () => {
    const { html } = render();
    // One pressed book and one pressed page count; the rest explicitly not pressed.
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(4);
  });

  it('keeps the sample lightbox reachable by keyboard on every card', () => {
    const { html } = render();
    expect(html.match(/aria-label="Open a sample [^"]+ album"/g)?.length).toBe(3);
    // Each one is focusable in its own right (it sits inside the card's button).
    expect(html.match(/tabindex="0"/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

// ── THE COMMIT SITS UNDER WHAT IT COMMITS ────────────────────────────────────────────────────

describe('the Continue button belongs to the configuration region', () => {
  const step = src('src/app/(app)/albums/new/_step-details.tsx');

  it('spans the two option columns by being full-width INSIDE their region', () => {
    // `w-full` in the nested region is what makes it track both columns and the gap at every
    // width — and is why it can never be wider than the viewport.
    expect(step).toMatch(/className=\{`h-14 w-full[^`]*`\}/);
    // It is not a fixed-width button centred under the whole page any more.
    expect(step).not.toContain('min-w-[240px]');
    expect(step).not.toContain('mt-10 flex justify-center');
  });

  it('is nested with the columns, so the rail cannot set its position', () => {
    // The outer grid is CONFIGURATION | SPECIFICATION; the two option columns are a grid inside
    // the first. Flat, the button would be a second row whose height came from the rail.
    expect(step).toContain('lg:grid-cols-[minmax(0,1fr)_290px]');
    expect(step).toContain('xl:grid-cols-[minmax(0,1fr)_310px]');
    expect(step).toContain('grid gap-6 lg:grid-cols-2');
  });

  it('is substantially larger, and wears the app’s existing forest CTA surface', () => {
    const { html } = render();
    expect(step).toContain('LUX_PRIMARY');
    expect(step).toContain("from '@/components/brand'");
    expect(html).toContain('h-14');
    expect(html).toContain('sm:h-16');
    // No new gradient or colour was invented for it.
    expect(step).not.toMatch(/bg-gradient-to-/);
  });

  it('is one accessible button running the EXISTING action, in both states', () => {
    const idle = render();
    expect(idle.text).toContain('Continue');
    expect(idle.html).toMatch(/<button[^>]*class="[^"]*w-full/);
    expect(idle.html).not.toContain('disabled=""');

    // Disabled until a page count is chosen — the wizard's rule, unchanged.
    const blocked = render({ pageCount: null });
    expect(blocked.html).toContain('disabled=""');

    // And the in-flight state still says so rather than silently doing nothing.
    expect(render({ creating: true }).text).toContain('Creating');
  });
});

// ── THE SPECIFICATION RAIL IS UNTOUCHED ──────────────────────────────────────────────────────

describe('the specification rail stays its own column', () => {
  it('still renders the same panel, with the same live values', () => {
    const { text } = render();
    expect(text).toContain('Your specification');
    expect(text).toContain('Standard');
    expect(text).toContain('Dimensions');
    expect(text).toContain('21 × 29.7 cm');
    expect(text).toContain('Pages');
    expect(text).toContain('Photo capacity');
  });

  it('keeps its sticky behaviour and is not stretched to fit the new button', () => {
    const step = src('src/app/(app)/albums/new/_step-details.tsx');
    expect(step).toContain('lg:sticky lg:top-24 lg:self-start');
    expect(step).toContain('aspect-[4/3]');
  });
});

// ── RESPONSIVE ───────────────────────────────────────────────────────────────────────────────

describe('the desktop composition is a desktop composition', () => {
  const step = src('src/app/(app)/albums/new/_step-details.tsx');

  it('collapses to one column below lg, as it always did', () => {
    // Every column rule is lg-prefixed, so narrow viewports get the same single-column stack
    // (book, pages, button, rail) they had before this change.
    for (const cls of ['lg:grid-cols-[minmax(0,1fr)_290px]', 'grid gap-6 lg:grid-cols-2']) {
      expect(step).toContain(cls);
    }
    expect(step).not.toMatch(/(?<!lg:)(?<!xl:)(?<!sm:)grid-cols-3/);
  });

  it('hard-codes no width on anything that has to fit the viewport', () => {
    // The button and both columns are fluid; the only fixed widths left are the rail's track and
    // the card thumbnail, which is a flex-none basis beside a `min-w-0` body and therefore
    // shrinks the text rather than pushing the row wider.
    expect(step).not.toContain('min-w-[');
    expect(step).toMatch(/className=\{`h-14 w-full/);
    expect(step).toContain('minmax(0,1fr)');
    expect(src('src/app/(app)/albums/new/_product-select.tsx')).toContain('min-w-0 flex-1');
  });
});
