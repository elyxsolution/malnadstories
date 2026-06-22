-- ============================================================
-- Malnad Stories — 0036: Error Tracking & Observability (Phase 10B)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the Error Center + capture layer read/write this table + RPC).
-- ============================================================
--
-- Additive RELIABILITY/DEBUGGING layer: a persisted, append-only store of captured failures,
-- exceptions, and slow operations across the app + worker. It is written ONLY through the
-- record_error_event() SECURITY DEFINER RPC (service role) and read ONLY by admins (RBAC-gated
-- in the app: observability:view / observability:manage). It touches nothing in
-- checkout/builder/orders/payments/uploads/PDF/reviews/refunds/reprints/CMS/shipping/RBAC, and
-- reuses the 0035 system_alerts table (dedupe_key contract) for critical-error alerting.
--
-- Enum values are LOWERCASE to match the rest of the schema (system_alerts severities). The
-- admin UI renders them uppercase (INFO/WARNING/ERROR/CRITICAL) per the spec.
--
-- Append-only: rows are inserted + occurrence-bumped + (resolve-)marked. NO DELETE grant to
-- anyone — history is immutable.

-- ── 1. error_events ───────────────────────────────────────────────────────────
create table if not exists public.error_events (
  id            uuid primary key default gen_random_uuid(),
  severity      text not null check (severity in ('info','warning','error','critical')),
  source        text not null,                          -- 'razorpay-webhook' | 'album-pdf' | 'client' | ...
  category      text not null
                  check (category in ('api','payment','upload','pdf','email','auth','support','shipping','system')),
  message       text not null,
  stack         text,
  request_id    text,                                   -- correlation id (x-request-id / job id)
  user_id       uuid references public.profiles(id) on delete set null,  -- PII-min: uuid only
  metadata      jsonb,
  -- Stable per-condition key (hash of category|source|normalized message) → dedupe. With the
  -- partial unique index below, an unresolved condition is ONE growing row (occurrences++),
  -- never N rows — so a hot failure loop can't flood the table.
  fingerprint   text not null,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  occurrences   integer not null default 1
);

create index if not exists error_events_feed_idx   on public.error_events (resolved, last_seen_at desc);
create index if not exists error_events_filter_idx on public.error_events (category, severity, last_seen_at desc);
-- AT MOST ONE open row per fingerprint → occurrence aggregation + no duplicate storms.
create unique index if not exists error_events_one_open_per_fingerprint
  on public.error_events (fingerprint) where resolved = false;

-- ── 2. RLS + grants (admin-only read; service-role write; no delete) ──────────
alter table public.error_events enable row level security;

drop policy if exists "error_events_select" on public.error_events;
create policy "error_events_select" on public.error_events for select to authenticated
  using (public.is_admin());

-- No client writes — capture writes only via the service role (record_error_event).
drop policy if exists "error_events_deny_insert" on public.error_events;
create policy "error_events_deny_insert" on public.error_events as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "error_events_deny_update" on public.error_events;
create policy "error_events_deny_update" on public.error_events as restrictive for update to authenticated, anon using (false);
drop policy if exists "error_events_deny_delete" on public.error_events;
create policy "error_events_deny_delete" on public.error_events as restrictive for delete to authenticated, anon using (false);

-- Append-only: service_role may select/insert/update (occurrence-bump + resolve) but NOT delete.
grant select, insert, update on table public.error_events to service_role;
grant select                 on table public.error_events to authenticated;
revoke all                   on table public.error_events from anon;

-- ── 3. record_error_event() — THE single capture entrypoint (app + worker) ────
-- Atomic dedupe-upsert. On a NEW row it also (a) writes an 'error.created' audit row and (b)
-- for a critical error, opens a system_alert (0035) keyed 'error:<fingerprint>' — reusing the
-- system_alerts_one_open_per_key partial unique index so criticals never storm the alert feed.
create or replace function public.record_error_event(
  p_severity   text,
  p_source     text,
  p_category   text,
  p_message    text,
  p_stack      text,
  p_request_id text,
  p_user_id    uuid,
  p_metadata   jsonb,
  p_fingerprint text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_is_new  boolean := false;
begin
  -- 1) Bump an existing OPEN row for this fingerprint (occurrence aggregation).
  update public.error_events
     set occurrences  = occurrences + 1,
         last_seen_at = now(),
         -- keep the most severe severity seen for this condition
         severity     = case
                          when array_position(array['info','warning','error','critical'], p_severity)
                             > array_position(array['info','warning','error','critical'], severity)
                          then p_severity else severity end,
         message      = p_message,
         stack        = coalesce(p_stack, stack),
         request_id   = coalesce(p_request_id, request_id),
         metadata     = coalesce(p_metadata, metadata)
   where fingerprint = p_fingerprint and resolved = false
   returning id into v_id;

  -- 2) Otherwise insert a fresh row. The unique partial index guards against a race: if a
  --    concurrent insert won, fall back to the bump path.
  if v_id is null then
    begin
      insert into public.error_events
        (severity, source, category, message, stack, request_id, user_id, metadata, fingerprint)
      values
        (p_severity, p_source, p_category, p_message, p_stack, p_request_id, p_user_id, p_metadata, p_fingerprint)
      returning id into v_id;
      v_is_new := true;
    exception when unique_violation then
      update public.error_events
         set occurrences = occurrences + 1, last_seen_at = now()
       where fingerprint = p_fingerprint and resolved = false
       returning id into v_id;
    end;
  end if;

  -- 3) New-row side effects: audit + (critical) open a deduped alert.
  if v_is_new then
    perform public.log_audit(
      p_user_id, 'system', 'error.created', 'error_event', v_id,
      jsonb_build_object('severity', p_severity, 'source', p_source, 'category', p_category, 'fingerprint', p_fingerprint)
    );

    if p_severity = 'critical' then
      insert into public.system_alerts (severity, source, title, message, dedupe_key)
      values ('critical', p_source, left('Error: ' || p_message, 200), 'Critical error captured — see the Error Center.', 'error:' || p_fingerprint)
      on conflict (dedupe_key) where resolved = false do nothing;
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.record_error_event(text,text,text,text,text,text,uuid,jsonb,text)
  from public, anon, authenticated;
grant  execute on function public.record_error_event(text,text,text,text,text,text,uuid,jsonb,text)
  to service_role;
