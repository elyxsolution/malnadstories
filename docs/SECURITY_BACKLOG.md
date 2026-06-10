# Pre-launch Security Hardening Backlog

> **STATUS (authored):** `0020` and `0021` are now WRITTEN as
> `drizzle/0020_photos_column_lockdown.sql` and `drizzle/0021_album_status_hardening.sql`,
> with their paired code changes shipped (`createAlbum` no longer inserts `status`;
> `submitAlbum` writes `status` via the service role). The migration designs below were
> **drift-corrected** before authoring — the original `0021` sketch predated the cover
> feature and omitted `cover_template_id`/`updated_at` from the album grants (which would
> have broken `selectCover` and `createAlbum`). **Deploy order: ship the code FIRST, then
> run the SQL in the Supabase Dashboard.** They are NOT yet applied to production.

These close the remaining "client can write server-controlled columns" findings from the
admin/payment security reviews — the same class as the `0019` `profiles.role` fix.

---

## 0020_photos_column_lockdown.sql — MEDIUM

### Risk assessment
`authenticated` holds table-wide `INSERT/UPDATE/DELETE` on **all** `photos` columns
(`0003`), but `status`, `sanitized_key`, `thumb_key`, `r2_key`, `width`, `height`,
`taken_at` are meant to be written **only by the worker (service role)**. A user can
`update photos set status='ready', sanitized_key='<key>'` on their own row, which lets
them (a) bypass server-side image hardening for their own album (serve an un-sanitized
original), and (b) make the presign path sign whatever `sanitized_key` they set — so a
key pointing at another user's object would yield that object's signed URL.
**Mitigating factor (why MEDIUM not HIGH):** R2 keys are
`{user_id}/albums/{album_id}/{uuid}…` — all unguessable UUIDs, and RLS hides other
users' ids/keys, so there is no practical path to obtain a victim's key. The exploit is
theoretical; the trust pattern is still wrong.

### Migration design (verify exact insert columns against the confirm route first)
```sql
revoke insert, update, delete on table public.photos from authenticated;
-- INSERT only what /api/photos/confirm writes (status defaults to 'pending'):
grant insert (user_id, album_id, r2_key, original_filename) on table public.photos to authenticated;
-- UPDATE only the non-destructive edit config (savePhotoEdit); worker columns stay service-role.
grant update (edit_config) on table public.photos to authenticated;
-- DELETE kept (the /api/photos/[id] route removes the row + objects).
-- SELECT (from 0003) unchanged. service_role keeps full access (0009) → worker unaffected.
```
RLS `users_own_photos` (`user_id = auth.uid()`) is preserved.

### Expected impact
None to legitimate flows **if** the insert column list exactly matches the `confirm`
route and `savePhotoEdit` only writes `edit_config` (both must be confirmed at build
time). Worker writes (`status/sanitized_key/thumb_key/width/height/taken_at`) go via the
service role and are unaffected. Closes hardening-bypass + the theoretical cross-user
read.

### Implementation effort
~30 min: confirm `confirm` route's insert column set + `savePhotoEdit`'s update column,
write the migration, then test upload → process → edit → delete end-to-end.

---

## 0021_album_status_hardening.sql — MEDIUM

### Risk assessment
`authenticated` can write `albums.status` directly (full CRUD, no column lock, no
CHECK). `createOrder` only checks `status==='submitted'`, so a user can
`update albums set status='submitted'` (or `insert … status='submitted'`) on an
**incomplete** album — bypassing `submitAlbum`'s completeness validation — then check
out and pay for it. The business then prints an incomplete product. No cross-user impact
and the amount is still server-computed, so it's an **integrity** gap, not a breach.

### Migration design (ships WITH a code change)
The legitimate writer of `status` is `submitAlbum`, which currently uses the
**authenticated** client. To lock `status` away from clients it must move to the
service role first:
1. **Code:** `submitAlbum` keeps its RLS-scoped re-read + completeness validation, then
   performs the `status='submitted'` write via `createServiceClient()` (guarded to the
   owner's album id, like `cancelOrder`).
2. **Migration:**
```sql
alter table public.albums drop constraint if exists albums_status_check;
alter table public.albums add constraint albums_status_check check (status in ('draft','submitted'));

revoke insert, update, delete on table public.albums from authenticated;
grant insert (user_id, title, size) on table public.albums to authenticated;  -- status defaults 'draft'
grant update (title) on table public.albums to authenticated;                  -- status no longer client-writable
-- DELETE kept (deleteAlbum). SELECT unchanged. service_role keeps full access.
```
RLS `users_own_albums` preserved. After this, the only way to reach `status='submitted'`
is `submitAlbum` (service-role, after validation).

### Expected impact
`createAlbum` (insert `user_id,title,size`), `deleteAlbum` (delete), and any future
title edit keep working; `submitAlbum` switches its single status write to the service
role. Closes the "pay for an incomplete album" integrity gap.

### Implementation effort
~1–1.5 h: move `submitAlbum`'s status write to service-role + guard, write the
migration, verify create → build → submit → checkout and that a direct
`update albums set status='submitted'` from the client is now denied.

---

## Sequencing
Both are **pre-launch** (not blockers for Stage D, which doesn't touch these tables).
Recommended order: `0020` (pure grants, ~30 min) then `0021` (grants + the `submitAlbum`
service-role change). Run each migration **with** its matching app deploy.
