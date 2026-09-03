-- One-time-use tracking for cross-Worker SSO hand-off tokens
-- (worker/sso.ts, worker/index.ts's /api/sso/resolve). `nonce` as the
-- primary key is the actual enforcement mechanism: redeeming a token twice
-- means inserting the same nonce twice, which hits a unique-violation and
-- fails — there's no separate check-then-act step to race.
--
-- No RLS policies are defined on purpose: this table is only ever touched
-- by the Worker using the service_role key (which bypasses RLS), never by a
-- client with a user's own session. Enabling RLS with zero policies means
-- even a hypothetical anon/authenticated-role query returns nothing, rather
-- than relying on GRANTs alone to keep it private.

create table public.sso_nonces (
  nonce text primary key,
  user_id uuid not null,
  product text not null,
  consumed_at timestamptz not null default now()
);
grant all on public.sso_nonces to service_role;
alter table public.sso_nonces enable row level security;
