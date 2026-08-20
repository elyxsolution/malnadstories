import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { PresignUploadSchema } from '@/lib/validations';
import { presignPut, ALLOWED_CONTENT_TYPES, type AllowedContentType } from '@/lib/r2';
import { photoCap } from '@/lib/builder/model';
import { isEditingLocked } from '@/lib/orders/album-lock';
import { workerConfigOk } from '@/lib/worker/health';
import { checkLimit } from '@/lib/security/guard';

/**
 * POST /api/photos/presign
 *
 * Returns a short-lived presigned PUT URL so the browser can upload a file
 * directly to R2. NOTHING here is trusted from the client: the user must own the
 * album, the type must be allowed, the size must be within the cap, and the album
 * must not already be full. The signature pins content-type + content-length.
 *
 * RETRY RE-SIGNING (Phase 6, decision C2). An optional `key` lets a client resume an upload it
 * already started instead of forking a second identity. That matters because `photos.upload_key`
 * is the idempotency key for `/api/photos/confirm` (0053): a retry that minted a fresh key would
 * produce a duplicate photo row, a duplicate hardening job, a second consumed cap slot, and an
 * orphaned R2 object. Re-signing the SAME key makes a PUT retry overwrite its own object.
 *
 * It is a request to re-sign a key the caller ALREADY OWNS — never a way to name one. The seven
 * checks in `validateRetryKey` re-derive everything from the session rather than trusting any of
 * it, so the widest thing a caller can do with this parameter is re-upload bytes to an object
 * they created moments ago and have not yet confirmed.
 */

/**
 * The exact shape `randomUUID()` produces below, and nothing else. This is what excludes every
 * other object in the bucket by construction: derivative masters (`…_full.jpg`), thumbnails
 * (`…_thumb.jpg`), `preview.pdf`, and the `covers/` and `stickers/` namespaces all fail it,
 * because a v4 UUID contains no underscore and the basename must be a bare UUID plus extension.
 */
const RAW_BASENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{3,4}$/;

/** Structural verdict. Every rejection is deterministic, so the client must not retry it. */
type RetryKeyVerdict = { ok: true } | { ok: false; error: string };

/**
 * Validate a client-supplied retry key against the session. Every rule is structural, so there
 * is nothing here that a caller can talk their way past with a crafted string.
 */
function validateRetryKey(key: string, userId: string, albumId: string, ext: string): RetryKeyVerdict {
  // (3)+(4) Prefix: the key must live under THIS user and THIS album. `userId` comes from the
  // verified JWT and `albumId` has already been proven owned, so this single check pins both.
  const prefix = `${userId}/albums/${albumId}/`;
  if (!key.startsWith(prefix)) return { ok: false, error: 'Invalid object key' };

  const basename = key.slice(prefix.length);
  // No further path segments: `…/albums/<id>/sub/dir/file.jpg` is not a raw upload key.
  if (basename.includes('/')) return { ok: false, error: 'Invalid object key' };

  // (5) Shape: a bare UUID basename. Rejects derivatives, the PDF, and anything hand-written.
  if (!RAW_BASENAME.test(basename)) return { ok: false, error: 'Invalid object key' };

  // (6) Extension must match the content type being re-signed. The worker derives the sanitized
  // and thumbnail keys from this key, so letting a retry switch type would desynchronise them.
  if (!basename.endsWith(`.${ext}`)) return { ok: false, error: 'Invalid object key' };

  return { ok: true };
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per-user mint throttle (Phase 10C). Burst-friendly so genuine bulk uploads are
  // unaffected; caps a client minting unbounded presigned URLs. (photoCap already
  // bounds usable rows; this caps churn/abuse.)
  const rl = await checkLimit(`presign:${user.id}`, 120, 60_000, {
    surface: 'upload_presign',
    actor: { userId: user.id },
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  // Fail-closed in production: every uploaded photo MUST be hardened by the worker
  // before it's usable, so refuse to even mint an upload URL when the worker is
  // unconfigured (a broken deploy). Cheap + network-free; in dev this is a no-op.
  // (The transient "worker asleep" case is handled by the client wake-up gate before
  // upload, and the worker's sweep is the eventual backstop.)
  if (!workerConfigOk()) {
    return NextResponse.json(
      { error: 'Photo processing is temporarily unavailable. Please try again later.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = PresignUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { albumId, contentType, size, key: retryKey } = parsed.data;

  // Ownership gate: RLS scopes this SELECT to the user's own albums. A foreign or
  // non-existent album returns null → reject. Never trust the client's claim.
  const { data: album } = await supabase
    .from('albums')
    .select('id, size')
    .eq('id', albumId)
    .maybeSingle();

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404 });
  }

  // Edit lock: a purchased album is frozen. The state-changing step (confirm) already
  // enforces this; we also reject at presign so a paid album can't even mint upload
  // URLs (no orphaned R2 objects, no wasted work). Same paid signal everywhere.
  if (await isEditingLocked(supabase, albumId)) {
    return NextResponse.json(
      { error: 'This album is part of a paid order and can no longer be changed.' },
      { status: 403 },
    );
  }

  // Per-album upload cap (see photoCap: 24→50, 36→75, 48→100). RLS scopes the count.
  // Rejected uploads don't count — they never become usable, so they shouldn't
  // consume a slot.
  const cap = photoCap((album as { size: number }).size);
  const { count } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', albumId)
    .neq('status', 'rejected');

  if ((count ?? 0) >= cap) {
    return NextResponse.json(
      { error: `This album is full (${cap} photos max).` },
      { status: 409 },
    );
  }

  const ext = ALLOWED_CONTENT_TYPES[contentType as AllowedContentType];

  /**
   * THE KEY. Minted server-side on a first attempt (unchanged), or re-signed on a retry.
   *
   * Checks (1) and (2) — album ownership via RLS, and the edit lock — already ran above and
   * apply to both paths identically. (3)–(6) are structural and live in `validateRetryKey`.
   * (7) is the one that needs the database: a key that a photo row has already claimed must
   * never be handed back out as a fresh upload target, or a confirmed photo's bytes could be
   * overwritten (and, once the worker has hardened and deleted the raw object, re-created).
   */
  let key: string;
  if (retryKey === undefined) {
    key = `${user.id}/albums/${albumId}/${randomUUID()}.${ext}`;
  } else {
    const verdict = validateRetryKey(retryKey, user.id, albumId, ext);
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: 400 });
    }

    /**
     * (7) Already claimed? Two plain equality filters rather than a composed `.or(...)` string:
     * this is a security check, and building a PostgREST filter by interpolation is exactly the
     * kind of thing that quietly stops matching when a value contains a reserved character.
     * Both are scoped by `user_id` AND run under RLS (`users_own_photos`), and the prefix check
     * above already proved the key is this user's, so neither can probe another user's photo.
     * `upload_key` is the immutable identity (0053); `r2_key` is checked too because a legacy
     * row may carry the key there with `upload_key` still null.
     */
    const claims = await Promise.all([
      supabase.from('photos').select('id').eq('user_id', user.id).eq('upload_key', retryKey).limit(1).maybeSingle(),
      supabase.from('photos').select('id').eq('user_id', user.id).eq('r2_key', retryKey).limit(1).maybeSingle(),
    ]);

    if (claims.some((c) => c.error)) {
      // Fail CLOSED but RETRYABLY: we cannot prove the key is unclaimed, and re-signing a
      // claimed key is the one outcome that could destroy a confirmed photo's bytes.
      console.error('presign retry-key lookup failed:', claims.find((c) => c.error)?.error);
      return NextResponse.json({ error: 'Could not start upload. Please try again.' }, { status: 503 });
    }

    if (claims.some((c) => c.data)) {
      // The upload already became a photo. This is a TERMINAL upload situation, not a reason to
      // create a second logical upload — the client's correct move is to (re)confirm the same
      // key, which is idempotent and returns the existing row. The code says exactly that.
      return NextResponse.json(
        { error: 'This upload has already been saved.', code: 'key_already_used' },
        { status: 409 },
      );
    }

    key = retryKey;
  }

  const url = await presignPut({
    key,
    contentType: contentType as AllowedContentType,
    contentLength: size,
  });

  return NextResponse.json({ url, key });
}
