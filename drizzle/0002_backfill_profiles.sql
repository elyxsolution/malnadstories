-- ============================================================
-- Malnad Stories — Migration 0002: backfill profiles + idempotent trigger
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Backfill a profile row for every auth.users entry that has none.
--    Safe to run multiple times — the WHERE filters to only missing rows.
insert into public.profiles (id, name)
select
  au.id,
  coalesce(
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1)
  )
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null;

-- 2. Replace the trigger function with an idempotent version.
--    ON CONFLICT DO NOTHING means a duplicate signup event can never
--    cause a unique-violation, and a profile is always guaranteed to exist
--    before any FK-dependent insert (albums, photos, etc.).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
