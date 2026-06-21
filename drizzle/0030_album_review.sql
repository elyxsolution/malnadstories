-- ============================================================
-- Malnad Stories — 0030: Album Review & Request-Changes workflow (Phase 9C)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying
-- the matching app code — the new code reads these tables / RPCs).
-- ============================================================
--
-- Additive, PARALLEL review layer. When a customer submits an album it enters
-- PENDING_REVIEW; an admin can APPROVE / REQUEST CHANGES / REJECT; on "request changes"
-- the customer gets the notes, re-opens the builder, edits, and resubmits — looping
-- until approved. This is ADVISORY only: it NEVER gates checkout, never touches
-- orders / payments / webhooks / Razorpay / R2 / album_pdfs / albums.status / fulfilment.
-- It writes ONLY to album_reviews, revision_requests and audit_log.
--
-- Reuses the EXACT security model of 0028 (Support) / 0029 (Refund-Reprint):
--   • Customer-owned → authenticated client + RLS (customer_id = auth.uid()).
--   • No client writes — every transition is a SECURITY DEFINER RPC called from a
--     requireAdmin-gated (admin) or already-authorized (customer submit) service action.
--   • Audit → log_audit() (0016). entity_type ∈ ('album_review','revision_request').
--
-- Enum values are LOWERCASE to match the rest of the schema.

-- ── 1. album_reviews (one row per album) ─────────────────────────────────────
create table if not exists public.album_reviews (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null unique references public.albums(id) on delete cascade,
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending_review'
                  check (status in ('pending_review','approved','changes_requested','rejected')),
  -- The reviewer's latest note to the CUSTOMER (the decision message). Customer-visible
  -- (unlike refund.admin_notes, which is internal). Full history lives in audit_log.
  review_notes  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  reviewed_at   timestamptz,                                       -- set on a decision
  reviewed_by   uuid references public.profiles(id) on delete set null  -- internal (hidden from customer)
);

create index if not exists album_reviews_status_idx   on public.album_reviews (status, updated_at desc);
create index if not exists album_reviews_customer_idx on public.album_reviews (customer_id, updated_at desc);

-- ── 2. revision_requests (the change-request timeline) ───────────────────────
create table if not exists public.revision_requests (
  id                uuid primary key default gen_random_uuid(),
  album_review_id   uuid not null references public.album_reviews(id) on delete cascade,
  album_id          uuid not null references public.albums(id) on delete cascade,
  customer_id       uuid not null references public.profiles(id) on delete cascade,
  requested_changes text not null,                                 -- admin's instructions (customer-visible)
  status            text not null default 'open'
                      check (status in ('open','in_progress','resubmitted','completed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists revision_requests_review_idx   on public.revision_requests (album_review_id, created_at);
create index if not exists revision_requests_customer_idx on public.revision_requests (customer_id, created_at desc);
create index if not exists revision_requests_album_idx    on public.revision_requests (album_id);
-- One ACTIVE revision loop per review (completed rows stay → history retained).
create unique index if not exists revision_requests_one_active_per_review
  on public.revision_requests (album_review_id)
  where status in ('open','in_progress','resubmitted');

-- ── 3. Customer submit transition (SECURITY DEFINER) ─────────────────────────
-- Called from submitAlbum (already RLS-verified ownership + completeness) AND covers
-- resubmits. Definer bypasses RLS, so it re-verifies the album belongs to p_customer_id.
-- Upserts the review to pending_review (clearing any prior decision) and resets an
-- active revision to 'resubmitted'. Idempotent.
create or replace function public.submit_album_for_review(
  p_album_id uuid, p_customer_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner   uuid;
  v_review  uuid;
  v_existed boolean := false;
  v_revisions int := 0;
begin
  select user_id into v_owner from public.albums where id = p_album_id;
  if v_owner is null then return 'album_not_found'; end if;
  if v_owner <> p_customer_id then return 'forbidden'; end if;

  select id into v_review from public.album_reviews where album_id = p_album_id for update;
  v_existed := found;

  if not v_existed then
    -- ON CONFLICT guards a concurrent double-submit (unique album_id) — the loser falls
    -- through to the row and is treated as a resubmit.
    insert into public.album_reviews (album_id, customer_id, status)
      values (p_album_id, p_customer_id, 'pending_review')
      on conflict (album_id) do nothing
      returning id into v_review;
    if v_review is null then
      select id into v_review from public.album_reviews where album_id = p_album_id for update;
      v_existed := true;
    else
      perform public.log_audit(p_customer_id, 'customer', 'review.created', 'album_review', v_review,
        jsonb_build_object('album_id', p_album_id));
    end if;
  end if;

  if v_existed then
    update public.album_reviews
       set status      = 'pending_review',
           reviewed_at = null,
           reviewed_by = null,
           updated_at  = now()
     where id = v_review;
    perform public.log_audit(p_customer_id, 'customer', 'review.resubmitted', 'album_review', v_review,
      jsonb_build_object('album_id', p_album_id));
  end if;

  -- Reset any in-flight revision so the admin sees a fresh submission to review.
  with bumped as (
    update public.revision_requests
       set status = 'resubmitted', updated_at = now()
     where album_review_id = v_review and status in ('open','in_progress')
     returning id
  )
  select count(*) into v_revisions from bumped;

  if v_revisions > 0 then
    perform public.log_audit(p_customer_id, 'customer', 'revision.resubmitted', 'album_review', v_review,
      jsonb_build_object('album_id', p_album_id));
  end if;

  return 'ok';
end; $$;

-- ── 4. Customer "started editing" signal (SECURITY DEFINER) ──────────────────
-- Best-effort: bumps the album's active 'open' revision → 'in_progress' when the
-- customer opens the builder from the Review Center. Ownership re-verified.
create or replace function public.mark_revision_in_progress(
  p_album_id uuid, p_customer_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
  v_rev   uuid;
begin
  select user_id into v_owner from public.albums where id = p_album_id;
  if v_owner is null then return 'album_not_found'; end if;
  if v_owner <> p_customer_id then return 'forbidden'; end if;

  update public.revision_requests
     set status = 'in_progress', updated_at = now()
   where album_id = p_album_id and status = 'open'
   returning id into v_rev;

  if v_rev is not null then
    perform public.log_audit(p_customer_id, 'customer', 'revision.in_progress', 'revision_request', v_rev,
      jsonb_build_object('album_id', p_album_id));
  end if;
  return 'ok';
end; $$;

-- ── 5. Admin decision (SECURITY DEFINER) ─────────────────────────────────────
-- Forward state machine (NOT the order/album lifecycle — those are untouched):
--   pending_review     → approved | changes_requested | rejected
--   changes_requested  → approved | changes_requested | rejected
--   approved | rejected → terminal
-- changes_requested REQUIRES p_notes (the requested changes) and opens a revision_request.
-- approved completes any active revision. Records the decision only — no side effects.
create or replace function public.admin_set_album_review(
  p_review_id uuid, p_actor_id uuid, p_status text, p_notes text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old      text;
  v_album    uuid;
  v_customer uuid;
  v_allowed  text[];
  v_note     text := nullif(btrim(p_notes), '');
begin
  if p_status not in ('approved','changes_requested','rejected') then
    return 'invalid_status';
  end if;

  select status, album_id, customer_id
    into v_old, v_album, v_customer
    from public.album_reviews where id = p_review_id for update;
  if not found then return 'review_not_found'; end if;

  v_allowed := case v_old
    when 'pending_review'    then array['approved','changes_requested','rejected']
    when 'changes_requested' then array['approved','changes_requested','rejected']
    else array[]::text[] end;
  if not (p_status = any(v_allowed)) then return 'invalid_transition'; end if;

  if p_status = 'changes_requested' and v_note is null then
    return 'note_required';
  end if;

  update public.album_reviews
     set status      = p_status,
         review_notes = coalesce(v_note, review_notes),
         reviewed_at = now(),
         reviewed_by = p_actor_id,
         updated_at  = now()
   where id = p_review_id;

  perform public.log_audit(p_actor_id, 'admin', 'review.status_changed', 'album_review', p_review_id,
    jsonb_build_object('from', v_old, 'to', p_status, 'album_id', v_album));

  if p_status = 'changes_requested' then
    -- The requested changes ARE the note. If a revision is already active (e.g. the admin
    -- amends the request before the customer resubmits), refresh its instructions in place
    -- (the partial unique index allows only one active revision); otherwise open a new one.
    if exists (
      select 1 from public.revision_requests
       where album_review_id = p_review_id and status in ('open','in_progress','resubmitted')
    ) then
      update public.revision_requests
         set requested_changes = v_note, status = 'open', updated_at = now()
       where album_review_id = p_review_id and status in ('open','in_progress','resubmitted');
    else
      insert into public.revision_requests (album_review_id, album_id, customer_id, requested_changes, status)
        values (p_review_id, v_album, v_customer, v_note, 'open');
      perform public.log_audit(p_actor_id, 'admin', 'revision.opened', 'revision_request',
        (select id from public.revision_requests
          where album_review_id = p_review_id and status = 'open'
          order by created_at desc limit 1),
        jsonb_build_object('album_id', v_album));
    end if;
  elsif p_status = 'approved' then
    -- Close out any in-flight revision on approval.
    update public.revision_requests
       set status = 'completed', completed_at = now(), updated_at = now()
     where album_review_id = p_review_id and status in ('open','in_progress','resubmitted');
    perform public.log_audit(p_actor_id, 'admin', 'revision.completed', 'album_review', p_review_id,
      jsonb_build_object('album_id', v_album));
  end if;

  return 'ok';
end; $$;

-- ── 6. Admin note (SECURITY DEFINER) ─────────────────────────────────────────
-- Overwrites review_notes (customer-visible message to the customer); audited.
create or replace function public.admin_add_review_note(
  p_review_id uuid, p_actor_id uuid, p_note text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(btrim(p_note), '') is null then return 'invalid_note'; end if;
  update public.album_reviews set review_notes = btrim(p_note), updated_at = now() where id = p_review_id;
  if not found then return 'review_not_found'; end if;
  perform public.log_audit(p_actor_id, 'admin', 'review.note_added', 'album_review', p_review_id,
    jsonb_build_object('note', btrim(p_note)));
  return 'ok';
end; $$;

-- Execute privileges: service_role only (callers are requireAdmin / already-authorized).
revoke execute on function public.submit_album_for_review(uuid,uuid)        from public, anon, authenticated;
revoke execute on function public.mark_revision_in_progress(uuid,uuid)      from public, anon, authenticated;
revoke execute on function public.admin_set_album_review(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.admin_add_review_note(uuid,uuid,text)      from public, anon, authenticated;
grant  execute on function public.submit_album_for_review(uuid,uuid)        to service_role;
grant  execute on function public.mark_revision_in_progress(uuid,uuid)      to service_role;
grant  execute on function public.admin_set_album_review(uuid,uuid,text,text) to service_role;
grant  execute on function public.admin_add_review_note(uuid,uuid,text)      to service_role;

-- ── 7. RLS + grants ──────────────────────────────────────────────────────────
alter table public.album_reviews    enable row level security;
alter table public.revision_requests enable row level security;

-- SELECT: a customer sees their own; admins see all (authenticated client; admins also
-- read the full row via Drizzle/service role).
drop policy if exists "album_reviews_select" on public.album_reviews;
create policy "album_reviews_select" on public.album_reviews for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
drop policy if exists "revision_requests_select" on public.revision_requests;
create policy "revision_requests_select" on public.revision_requests for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

-- No client writes — every transition is a SECURITY DEFINER RPC. Deny INSERT/UPDATE/DELETE.
drop policy if exists "album_reviews_deny_insert" on public.album_reviews;
create policy "album_reviews_deny_insert" on public.album_reviews as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "album_reviews_deny_update" on public.album_reviews;
create policy "album_reviews_deny_update" on public.album_reviews as restrictive for update to authenticated, anon using (false);
drop policy if exists "album_reviews_deny_delete" on public.album_reviews;
create policy "album_reviews_deny_delete" on public.album_reviews as restrictive for delete to authenticated, anon using (false);

drop policy if exists "revision_requests_deny_insert" on public.revision_requests;
create policy "revision_requests_deny_insert" on public.revision_requests as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "revision_requests_deny_update" on public.revision_requests;
create policy "revision_requests_deny_update" on public.revision_requests as restrictive for update to authenticated, anon using (false);
drop policy if exists "revision_requests_deny_delete" on public.revision_requests;
create policy "revision_requests_deny_delete" on public.revision_requests as restrictive for delete to authenticated, anon using (false);

-- Column-scoped SELECT. album_reviews: everything EXCEPT reviewed_by (internal).
-- revision_requests: all columns (all customer-visible). No INSERT/UPDATE grants.
grant select (id, album_id, customer_id, status, review_notes, created_at, updated_at, reviewed_at)
  on public.album_reviews to authenticated;
grant select (id, album_review_id, album_id, customer_id, requested_changes, status, created_at, updated_at, completed_at)
  on public.revision_requests to authenticated;

grant all on table public.album_reviews    to service_role;
grant all on table public.revision_requests to service_role;
revoke all on table public.album_reviews    from anon;
revoke all on table public.revision_requests from anon;
