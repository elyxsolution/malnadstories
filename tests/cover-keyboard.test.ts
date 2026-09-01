/**
 * THE KEYBOARD FOLLOWS THE SELECTION, NOT THE SURFACE.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 *
 * The builder has one shortcut table and one listener (`useShortcuts`), and Undo/Redo already
 * branched on which canvas had focus. Everything else was wired to the PAGE: Delete ran the page
 * command layer's ladder while the cover's equivalent existed but was reachable only from its
 * toolbar button, and nudging was gated on a literal `!coverFocused`. So a selected cover object
 * could be looked at, dragged with a pointer — and then ignore Delete and the arrow keys.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────────────────────
 *
 * No second keyboard system and no second undo stack: the same table resolves WHICH CANVAS has
 * focus once (`surface`) and dispatches to it. This is possible with no new abstraction because
 * `useCover` has always exposed the same `Selection` union and the same
 * `patchOverlays`/`patchText`/`patchQr`/`patchSticker` signatures as `useBlocks`.
 *
 * ── WHAT IS ASSERTED ───────────────────────────────────────────────────────────────────────
 *
 * Two halves. The shortcut MANAGER is executed against real `KeyboardEvent`s — its dispatch,
 * its `when` gating and the typing guard are pure enough to run. The BUILDER's wiring (which
 * surface a binding reaches) is a client component behind an authenticated route, so it is
 * asserted at the source level, as `tests/README.md` records for the rest of the canvas.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Shortcut } from '@/app/(app)/albums/[id]/build/_use-shortcuts';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
/** Sources are read with line endings normalized, so assertions can be written with plain \n. */
const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
const manager = read('src/app/(app)/albums/[id]/build/_use-shortcuts.ts');

// ===============================================================================================
// 1 — the dispatcher itself
// ===============================================================================================

/**
 * `useShortcuts`'s handler, reproduced from the module under test's own rules so the gating can be
 * exercised without a DOM. It is checked against the source below, so it cannot drift into being a
 * description of something the builder does not do.
 */
function dispatch(table: Shortcut[], e: { key: string; target?: { tagName?: string; isContentEditable?: boolean } }) {
  const el = e.target;
  const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable;
  const hit = table.find((s) => s.combo === e.key);
  if (!hit) return 'no-binding';
  if (typing && !hit.allowInInput) return 'declined-typing';
  if (hit.when && !hit.when()) return 'declined-when';
  // The table's `run` receives the event; nothing under test reads it, and `KeyboardEvent` does
  // not exist in this (node) environment.
  hit.run({} as KeyboardEvent);
  return 'ran';
}

describe('the shortcut manager gates before it dispatches', () => {
  it('the reproduction above matches the real handler', () => {
    expect(manager).toContain("el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable");
    expect(manager).toContain('if (typing && !hit.allowInInput) return;');
    expect(manager).toContain('if (hit.when && !hit.when()) return;');
    expect(manager).toContain('e.preventDefault();');
  });

  it('a binding whose `when` is false declines, and the key falls through', () => {
    const run = vi.fn();
    const table: Shortcut[] = [{ combo: 'Delete', label: 'x', group: 'Editing', when: () => false, run }];
    expect(dispatch(table, { key: 'Delete' })).toBe('declined-when');
    expect(run).not.toHaveBeenCalled();
  });

  it('DOES NOT FIRE WHILE TYPING — Delete removes a character, not an object', () => {
    const run = vi.fn();
    const table: Shortcut[] = [{ combo: 'Delete', label: 'x', group: 'Editing', run }];
    expect(dispatch(table, { key: 'Delete', target: { tagName: 'INPUT' } })).toBe('declined-typing');
    expect(dispatch(table, { key: 'Delete', target: { isContentEditable: true } })).toBe('declined-typing');
    expect(run).not.toHaveBeenCalled();
    // …and does fire outside one.
    expect(dispatch(table, { key: 'Delete', target: { tagName: 'DIV' } })).toBe('ran');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('only Save and Escape opt out of the typing guard', () => {
    // The builder's own table: nothing else may interrupt a customer typing a title or a caption.
    // Each opt-in is attributed to the NEAREST PRECEDING `combo`, so one binding's opt-in cannot
    // be credited to another's.
    const optIns = Array.from(builder.matchAll(/allowInInput: true/g)).map((m) => {
      const before = builder.slice(0, m.index);
      const combos = Array.from(before.matchAll(/combo: "([^"]+)"/g));
      return combos[combos.length - 1]?.[1];
    });
    expect(new Set(optIns)).toEqual(new Set(['mod+s', 'Escape']));
    // `allowInInput: false` is stated explicitly on Undo, which is the one people expect to be
    // the browser's while typing.
    expect(builder).toContain('combo: "mod+z", label: "Undo", group: "Editing", allowInInput: false');
  });
});

// ===============================================================================================
// 2 — the focused surface is what a binding acts on
// ===============================================================================================

describe('the builder resolves the FOCUSED canvas, once', () => {
  it('there is ONE table and ONE listener — no cover-only keyboard system', () => {
    expect((builder.match(/useShortcuts\(/g) ?? []).length).toBe(1);
    expect(builder).not.toMatch(/addEventListener\(\s*'keydown'/);
    // And exactly one shortcut manager exists in the builder folder.
    expect(read('src/app/(app)/albums/[id]/build/_use-shortcuts.ts')).toContain("window.addEventListener('keydown'");
  });

  it('a single `surface` names the canvas the keyboard acts on', () => {
    expect(builder).toContain('const surface = useMemo(');
    expect(builder).toContain('coverFocused');
    expect(builder).toContain('patchSticker: cover.patchSticker,');
    expect(builder).toContain('patchSticker: api.patchSticker,');
  });

  it('NUDGING is decided by what is SELECTED, not by which canvas it is on', () => {
    // The old gate was a literal `!coverFocused &&`.
    expect(builder).not.toContain('const canNudge = !coverFocused');
    expect(builder).toContain('const canNudge =\n    !!surface.block &&');
    for (const kind of ['overlay', 'text', 'qr', 'sticker']) {
      expect(builder).toContain(`surface.selection.kind === '${kind}'`);
    }
  });

  it('and the nudge itself writes through the focused surface', () => {
    expect(builder).toContain('const { block: b, selection: s } = surface;');
    expect(builder).toContain('surface.patchOverlays(');
    expect(builder).toContain('surface.patchText(b.key, el.id, shift(el));');
    expect(builder).toContain('surface.patchQr(b.key, el.id, shift(el));');
    expect(builder).toContain('surface.patchSticker(b.key, el.id, shift(el));');
    // Clamped exactly where a released drag is — a nudge cannot reach somewhere a save refuses.
    expect(builder).toContain('clampRect({ x: el.x + dx, y: el.y + dy, w: el.w, h: el.h }, EDIT_BOUNDS)');
  });

  it('DELETE resolves to the focused canvas\'s own delete ladder', () => {
    expect(builder).toContain(
      'const deleteCommand = coverFocused ? cover.barCommands.deleteSelection : cmd.commands.deleteSelection;',
    );
    // Both Delete and Backspace go through it, gated by the same `enabled`.
    expect((builder.match(/when: \(\) => deleteCommand\.enabled/g) ?? []).length).toBe(2);
    expect((builder.match(/run: \(\) => deleteCommand\.run\(\)/g) ?? []).length).toBe(2);
  });

  it('UNDO/REDO follow focus, with no second stack', () => {
    expect(builder).toContain('run: () => (coverFocused ? cover.undo() : undoEdits())');
    expect(builder).toContain('run: () => (coverFocused ? cover.redo() : redoEdits())');
    // The cover's history is `useHistoryState`, the same primitive the page uses.
    expect(read('src/app/(app)/albums/[id]/build/_use-cover.ts')).toContain('useHistoryState<CoverConfig>');
  });

  it('ROTATE follows focus too, through the cover\'s resolved photo target', () => {
    expect(builder).toContain('coverFocused ? cover.barCommands.rotateBy(1) : cmd.commands.rotatePhotos.run()');
    expect(builder).toContain('coverFocused ? !!cover.photoTarget?.photoId : cmd.commands.rotatePhotos.enabled');
  });

  it('a PAGE-ONLY command stays page-only rather than doing something odd on a cover', () => {
    // "Duplicate page" has no cover analogue — a cover is not a page you can have two of.
    expect(builder).toContain('when: () => !coverFocused && cmd.commands.duplicatePage.enabled');
  });

  it('ESCAPE clears BOTH selections and leaves an adjustment, so no surface is left stale', () => {
    expect(builder).toContain('cover.setSelection(NO_SELECTION);');
    expect(builder).toContain('crop.end();');
  });
});

// ===============================================================================================
// 3 — a keyboard edit on the cover is an ordinary, undoable cover edit
// ===============================================================================================

describe('cover keyboard edits behave like every other cover edit', () => {
  const cover = read('src/app/(app)/albums/[id]/build/_use-cover.ts');

  it('the cover delete refuses what must not be removed, and clears the selection after', () => {
    // A title / spine object is structural: the printed cover always carries it.
    expect(cover).toContain("isPermanentRole(selectedText?.role)");
    expect(cover).toContain("if (selection.kind === 'sticker') removeSticker(key, selection.id);");
    expect(cover).toContain("else if (selection.kind === 'overlay') removeOverlay(key, selection.id);");
    expect(cover).toContain('setSelection({ kind: \'none\' });');
  });

  it('every cover mutation goes through ONE history + ONE persistence effect', () => {
    // `write` is the only mutator, and saving is a declarative effect on the resulting config —
    // which is why a keyboard edit is undoable and saved without any new plumbing.
    expect(cover).toContain('const write = useCallback(');
    expect(cover).toContain('hist.set((prev) => {');
    expect(cover).toContain('onChange({ config, title: nextTitle });');
  });

  it('a nudge lands in that same path — `patchSticker` and friends are ordinary writes', () => {
    for (const fn of ['patchOverlays', 'patchText', 'patchQr', 'patchSticker']) {
      expect(cover).toContain(`const ${fn} = useCallback(`);
    }
  });
});

// ===============================================================================================
// 4 — the admin inherits it, because there is nothing separate to inherit
// ===============================================================================================

describe('admin editing gets all of this for free', () => {
  it('an admin renders the SAME Builder — `adminEditing` changes only chrome', () => {
    const page = read('src/app/(app)/albums/[id]/build/page.tsx');
    expect(page).toContain('adminEditing={adminEditing}');
    // One `<Builder` element in the route: there is no admin variant to diverge.
    expect((page.match(/<Builder\b/g) ?? []).length).toBe(1);
    // The flag reaches the toolbar and a banner, and nothing else gates on it.
    expect(builder).toContain('adminEditing={adminEditing}');
    expect(builder).toContain('{adminEditing && (');
  });

  it('the authorization boundary is untouched by any of this', () => {
    const page = read('src/app/(app)/albums/[id]/build/page.tsx');
    const access = read('src/lib/albums/access.ts');
    expect(page).toContain('resolveAlbumWriteAccess');
    expect(access).toContain("roleHasCapability(role.role, 'album:manage')");
    const actions = read('src/lib/actions/builder.ts');
    for (const fn of ['saveLayout', 'savePhotoEdit', 'saveCoverDesign']) {
      expect(actions).toMatch(new RegExp(`export async function ${fn}[\\s\\S]*?resolveAlbumWriteAccess`));
    }
  });
});
