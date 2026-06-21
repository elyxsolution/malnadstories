-- ============================================================
-- Malnad Stories — 0033: Courier & Shipping Integration (Phase 9F)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the admin UI + order pages read these tables).
-- ============================================================
--
-- Additive, SUPPLEMENTAL shipment layer. shipment_status is INDEPENDENT of orders.status:
-- nothing here writes orders / payments / webhooks, and the existing fulfilment lifecycle
-- (admin_update_order_status), checkout, and the orders.tracking_number/carrier columns are
-- untouched. Admins still advance the order via the existing Fulfilment control — these
-- tables add structured courier metadata + an append-only event log + a courier-abstraction
-- seam for future Shiprocket/Delhivery/BlueDart/DTDC integration.
--
-- Security mirrors `payments` (child-of-order ownership):
--   • Customers SELECT only shipments/events for orders they own (via an EXISTS subquery
--     on orders.user_id = auth.uid()); admins see all (is_admin()).
--   • All writes are service-role only (no client write grant + restrictive deny). Admin
--     actions are requireShippingCapability-gated and audit via log_audit() (0016).
--   • There is NO tracking-number lookup path — a customer reaches a shipment only through
--     an order they own (no enumeration). The tracking/external_reference indexes exist for
--     a FUTURE service-role courier webhook reconciliation, never a public query.
--
-- Enum values are LOWERCASE to match the rest of the schema.

-- ── 1. shipments (one per order) ─────────────────────────────────────────────
create table if not exists public.shipments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null unique references public.orders(id) on delete cascade,
  courier            text not null
                       check (courier in ('shiprocket','delhivery','bluedart','dtdc','other')),
  tracking_number    text,
  shipment_status    text not null default 'created'
                       check (shipment_status in ('created','picked_up','in_transit','out_for_delivery','delivered','failed')),
  label_url          text,
  external_reference text,                              -- courier/provider id (webhook key)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null
);

create index if not exists shipments_status_idx   on public.shipments (shipment_status, updated_at desc);
create index if not exists shipments_tracking_idx  on public.shipments (courier, tracking_number);
create index if not exists shipments_extref_idx    on public.shipments (external_reference);

-- ── 2. shipment_events (append-only timeline) ────────────────────────────────
create table if not exists public.shipment_events (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_type  text not null
                check (event_type in ('shipment_created','picked_up','in_transit','out_for_delivery','delivered','failed')),
  description text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists shipment_events_shipment_idx on public.shipment_events (shipment_id, occurred_at);

-- ── 3. RLS + grants (child-of-order ownership, mirrors payments) ─────────────
alter table public.shipments       enable row level security;
alter table public.shipment_events enable row level security;

-- SELECT: a customer sees shipments for orders they own; admins see all.
drop policy if exists "shipments_select" on public.shipments;
create policy "shipments_select" on public.shipments for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- SELECT: events visible when the parent shipment's order belongs to the customer (or admin).
drop policy if exists "shipment_events_select" on public.shipment_events;
create policy "shipment_events_select" on public.shipment_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.shipments s
      join public.orders o on o.id = s.order_id
      where s.id = shipment_id and o.user_id = auth.uid()
    )
  );

-- No client writes — admins mutate via service-role actions. Deny INSERT/UPDATE/DELETE.
drop policy if exists "shipments_deny_insert" on public.shipments;
create policy "shipments_deny_insert" on public.shipments as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "shipments_deny_update" on public.shipments;
create policy "shipments_deny_update" on public.shipments as restrictive for update to authenticated, anon using (false);
drop policy if exists "shipments_deny_delete" on public.shipments;
create policy "shipments_deny_delete" on public.shipments as restrictive for delete to authenticated, anon using (false);

-- shipment_events is append-only: deny client insert/update/delete (service role inserts).
drop policy if exists "shipment_events_deny_insert" on public.shipment_events;
create policy "shipment_events_deny_insert" on public.shipment_events as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "shipment_events_deny_update" on public.shipment_events;
create policy "shipment_events_deny_update" on public.shipment_events as restrictive for update to authenticated, anon using (false);
drop policy if exists "shipment_events_deny_delete" on public.shipment_events;
create policy "shipment_events_deny_delete" on public.shipment_events as restrictive for delete to authenticated, anon using (false);

grant select on table public.shipments       to authenticated;
grant select on table public.shipment_events to authenticated;
grant all    on table public.shipments       to service_role;
grant all    on table public.shipment_events to service_role;
revoke all   on table public.shipments       from anon;
revoke all   on table public.shipment_events from anon;
