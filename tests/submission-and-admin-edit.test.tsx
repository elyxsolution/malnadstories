/**
 * TWO WORKFLOW CHANGES, EITHER SIDE OF SUBMISSION.
 *
 *   1. THE POST-SUBMISSION DIALOG — after a successful submit, offer the two things a customer
 *      actually wants next (buy this book / start another), plus a genuine way out of the question.
 *   2. ADMIN EDITING — an administrator reviewing a submitted album can open THE SAME builder and
 *      correct it, instead of sending it back to the customer for a two-second fix.
 *
 * ── WHAT THIS SUITE CAN AND CANNOT ASSERT ──────────────────────────────────────────────────
 *
 * The dialog is rendered for real (`react-dom/server`), so its structure, labels, roles and
 * accessible names are genuinely checked. Its CLICK BEHAVIOUR is not: this repository has no DOM
 * test environment (no jsdom, no Testing Library) and adding one is a dependency decision, not a
 * test. So the "✕ does not trigger either action" guarantee is asserted STRUCTURALLY — the close
 * control's only handler is `onClose`, and the two actions are reachable from nothing else — and
 * is listed in the final report as browser-unverified.
 *
 * The admin authorization boundary is asserted where it actually lives: the pure capability
 * function, and the source of the one gate every album write now passes through. It is not
 * executed against Supabase, for the reason `tests/README.md` already records — the only database
 * this repository can reach is production.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SubmittedDialog } from '@/app/(app)/albums/[id]/build/_builder-modals';
import { ROLE_CAPABILITIES, roleHasCapability, type AdminRole } from '@/lib/auth/capabilities';

/**
 * The dialog navigates with the App Router, which has no provider outside Next. Only `push` is
 * used, and only from the two action handlers — never from the close path this suite is about.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const ALBUM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// ===============================================================================================
// 1 — the post-submission dialog
// ===============================================================================================

describe('the post-submission dialog', () => {
  const html = renderToStaticMarkup(<SubmittedDialog albumId={ALBUM} onClose={() => {}} />);

  it('offers exactly the two primary options, and says the album was submitted', () => {
    expect(html).toContain('Album submitted');
    expect(html).toContain('Proceed to checkout');
    expect(html).toContain('Add to cart &amp; create one more album');
  });

  it('has a labelled close control in the top-right corner', () => {
    expect(html).toContain('aria-label="Close"');
    // Positioned in the corner rather than in the button stack — it is a dismissal, not a choice.
    expect(html).toMatch(/aria-label="Close"[^>]*class="[^"]*absolute right-3 top-3/);
  });

  it('is a real modal dialog for assistive technology', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="album-submitted-title"');
    expect(html).toContain('id="album-submitted-title"');
  });

  it('does not force a choice — the customer can leave with neither', () => {
    const src = read('src/app/(app)/albums/[id]/build/_builder-modals.tsx');
    // The ✕, Escape and the backdrop all call the SAME dismissal, and none of them can reach an
    // action: `goCheckout` and `goAnother` are referenced only by their own buttons.
    expect(src).toContain('onClick={onClose}');
    expect(src).toContain("if (e.key === 'Escape' && !busy)");
    expect(src).toContain('onClick={() => !busy && onClose()}');
    expect((src.match(/goCheckout/g) ?? []).length).toBe(2); // the definition + its one button
    expect((src.match(/goAnother/g) ?? []).length).toBe(2);
  });

  it('wires the EXISTING checkout and new-album routes, inventing neither', () => {
    const src = read('src/app/(app)/albums/[id]/build/_builder-modals.tsx');
    expect(src).toContain('router.push(`/checkout/${albumId}`)');
    expect(src).toContain("router.push('/albums/new')");
    // The same destination the toolbar's own Checkout button uses.
    expect(read('src/app/(app)/albums/[id]/build/_toolbar.tsx')).toContain('href={`/checkout/${albumId}`}');
  });

  /**
   * ENSURE, NOT INCREMENT — the Phase 6 cart invariant.
   *
   * `submitAlbum` has already best-effort called `ensureCartItem` for this album. Using
   * `addAlbumToCart` here would take the customer to quantity 2 for a book they asked to buy once.
   */
  it('"Add to cart" ENSURES the album is in the cart rather than incrementing it', () => {
    const src = read('src/app/(app)/albums/[id]/build/_builder-modals.tsx');
    expect(src).toContain('ensureAlbumInCart');
    expect(src).not.toContain('addAlbumToCart');

    const action = read('src/lib/actions/cart.ts');
    expect(action).toContain('export async function ensureAlbumInCart');
    // It reuses the ON CONFLICT DO NOTHING helper, and the same three eligibility gates.
    expect(action).toMatch(/ensureAlbumInCart[\s\S]*?ensureCartItem\(supabase, albumId\)/);
    expect(action).toMatch(/ensureAlbumInCart[\s\S]*?blueprint_draft_of !== null/);
    expect(action).toMatch(/ensureAlbumInCart[\s\S]*?status !== 'submitted'/);
  });

  it('opens only after a FIRST submission succeeds — a resubmit keeps its own dialog', () => {
    const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
    // Inside `doSubmit`'s success branch, on the non-`wasChanges` path.
    expect(builder).toMatch(/setResubmitted\(true\);[\s\S]*?\} else \{[\s\S]*?setSubmitted\(true\);/);
    expect(builder).toContain('{submitted && <SubmittedDialog albumId={albumId} onClose={() => setSubmitted(false)} />}');
  });

  it('closing changes nothing about the submission — it only hides the dialog', () => {
    const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
    // The only thing `onClose` does is flip the local flag. No delete, no status write, no cart.
    expect(builder).toContain('onClose={() => setSubmitted(false)}');
    // And the submission has already been persisted by the time it opens.
    expect(builder).toMatch(/const res = await submitAlbum\(albumId\);[\s\S]*?setStatus\('submitted'\)/);
  });
});

// ===============================================================================================
// 2 — admin editing: the SAME builder, behind the EXISTING gate
// ===============================================================================================

describe('admin album editing', () => {
  it('reuses the customer builder route — there is no admin album editor', () => {
    // The admin console and the review detail both link at `/albums/[id]/build`.
    expect(read('src/app/admin/albums/[id]/page.tsx')).toContain('href={`/albums/${album.id}/build`}');
    expect(read('src/app/admin/reviews/_detail.tsx')).toContain('href={`/albums/${review.albumId}/build`}');
    // Nothing anywhere declares a parallel editor.
    expect(() => read('src/app/admin/albums/[id]/_editor.tsx')).toThrow();
  });

  describe('authorization is server-side, at every boundary', () => {
    const access = read('src/lib/albums/access.ts');
    const page = read('src/app/(app)/albums/[id]/build/page.tsx');
    const actions = read('src/lib/actions/builder.ts');

    it('the OWNER path is unchanged — RLS answers first, and answers alone for a customer', () => {
      expect(access).toMatch(/const \{ data: own \} = await supabase[\s\S]*?if \(own\) return \{ client: supabase, actor: 'owner'/);
      // The service-role client is constructed only AFTER the capability check.
      const capIdx = access.indexOf("roleHasCapability(role.role, 'album:manage')");
      const svcIdx = access.indexOf('const svc = createServiceClient()');
      expect(capIdx).toBeGreaterThan(-1);
      expect(svcIdx).toBeGreaterThan(capIdx);
    });

    it('the ADMIN path requires the EXISTING `album:manage` capability, not a new one', () => {
      expect(access).toContain('getAdminContext');
      expect(access).toContain("roleHasCapability(role.role, 'album:manage')");
      // Same capability the admin PDF actions already require — one answer to "may this admin
      // act on an album", not one per feature.
      expect(read('src/lib/actions/admin/pdf.ts')).toContain("requireCapability('album:manage')");
    });

    it('the ROUTE is gated, so knowing the URL is not enough', () => {
      expect(page).toContain('resolveAlbumWriteAccess');
      expect(page).toContain("adminAccess?.actor === 'admin'");
      // A caller who is neither the owner nor an authorised admin still gets the ordinary 404.
      expect(page).toContain('if (!album) notFound();');
    });

    it('EVERY album write independently re-checks — the UI is never the boundary', () => {
      for (const fn of ['saveLayout', 'savePhotoEdit', 'saveCoverDesign']) {
        expect(actions).toMatch(new RegExp(`export async function ${fn}[\\s\\S]*?resolveAlbumWriteAccess`));
      }
    });

    it('an unauthorised caller cannot tell "not yours" from "does not exist"', () => {
      expect(access).toContain('return null');
      expect(actions).toMatch(/if \(!access\) return \{ ok: false, error: 'Album not found' \}/);
    });

    it('the roles that may NOT edit an album are unchanged and still cannot', () => {
      const may: AdminRole[] = ['super_admin', 'production'];
      const mayNot: AdminRole[] = ['support', 'content'];
      for (const r of may) expect(roleHasCapability(r, 'album:manage')).toBe(true);
      for (const r of mayNot) expect(roleHasCapability(r, 'album:manage')).toBe(false);
      // No new capability was invented for this feature.
      expect(JSON.stringify(ROLE_CAPABILITIES)).not.toContain('album:edit');
    });

    it('the entry buttons are hidden for a role that lacks the capability — as a courtesy', () => {
      expect(read('src/app/admin/albums/[id]/page.tsx')).toContain("roleHasCapability((await getAdminContext()).role, 'album:manage')");
      expect(read('src/app/admin/reviews/_detail.tsx')).toContain("roleHasCapability((await getAdminContext()).role, 'album:manage')");
    });
  });

  describe('the saved state stays the single source of truth', () => {
    const actions = read('src/lib/actions/builder.ts');

    it('an admin edit goes through the SAME actions, keeping every existing gate', () => {
      // The paid-order edit lock is still applied on both paths.
      expect(actions).toMatch(/saveLayout[\s\S]*?isEditingLocked\(supabase, albumId\)/);
      expect(actions).toMatch(/saveCoverDesign[\s\S]*?isEditingLocked\(supabase, albumId\)/);
      // Every referenced photo is still pinned to THIS album.
      expect(actions).toContain(".eq('album_id', albumId)");
    });

    it('the PDF renders from the DATABASE, so it cannot use a pre-edit snapshot', () => {
      // The worker drives the print route, which loads the album through `loadPrintAlbum` — a
      // service-role read of the rows `saveLayout` just wrote. No client state is involved, which
      // is why admin editing needed no PDF changes at all.
      const printData = read('src/lib/pdf/print-data.ts');
      expect(printData).toContain("from('album_pages')");
      expect(printData).toContain("from('albums')");
      expect(printData).toContain('baseEdits');
      // The generator is handed an ALBUM ID and options — never a layout payload — so there is no
      // client snapshot for it to render from even in principle.
      const generate = read('src/lib/pdf/generate.ts');
      expect(generate.replace(/\r/g, '')).toContain('startAlbumPdfGeneration(\n  albumId: string,\n  opts?:');
      expect(generate).not.toContain('blocks:');
    });

    it('an admin edit is AUDITED against the album and its owner', () => {
      const access = read('src/lib/albums/access.ts');
      expect(access).toContain("p_action: action");
      expect(access).toContain("p_entity_type: 'album'");
      expect(access).toContain('owner_id: access.ownerId');
      expect(actions).toContain("auditAdminAlbumEdit(access, albumId, 'album.layout_edited')");
      expect(actions).toContain("auditAdminAlbumEdit(access, albumId, 'album.cover_edited')");
    });

    it('the builder says whose album it is, and hides the customer-only terminal actions', () => {
      const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
      expect(builder).toContain('adminEditing &&');
      expect(builder).toContain('Admin edit');
      const toolbar = read('src/app/(app)/albums/[id]/build/_toolbar.tsx');
      // Submit and Checkout belong to the customer; Save (the point) stays.
      expect(toolbar).toContain('{adminEditing ? (');
    });
  });
});
