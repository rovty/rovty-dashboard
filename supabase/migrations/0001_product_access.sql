-- Product entitlements — deliberately separate from authentication.
-- Anyone who signs up (email/password, Google, or Microsoft) gets into the
-- dashboard shell; a row in this table is what actually unlocks a specific
-- product's features, the same split Cloudflare uses between "have an
-- account" and "have a paid plan for this service."
--
-- Run this once in the Supabase dashboard's SQL Editor (or via the Supabase
-- CLI if you adopt it later — this file works either way).

create table if not exists public.product_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Matches a product slug, e.g. 'wed' for Rovty Wed. Free-text rather than
  -- an enum so adding a new product never needs a migration.
  product text not null,
  status text not null default 'inactive' check (status in ('active', 'inactive')),
  granted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, product)
);

alter table public.product_access enable row level security;

-- Users can read their own entitlements (the dashboard needs this to show
-- what's unlocked) but there is no insert/update/delete policy for the
-- `authenticated` role — on purpose. Nobody can grant themselves access from
-- the client. Until a payment gateway is wired to do this automatically,
-- grant access yourself: Table Editor → product_access → insert a row, or
--
--   insert into public.product_access (user_id, product, status, granted_at)
--   values ('<user-uuid>', 'wed', 'active', now())
--   on conflict (user_id, product) do update
--     set status = 'active', granted_at = now();
--
-- (user-uuid is the id shown for that person in Authentication → Users.)
create policy "Users can read their own product access"
  on public.product_access
  for select
  to authenticated
  using (user_id = auth.uid());
