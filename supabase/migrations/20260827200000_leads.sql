-- Lead capture from the public /contact marketing page. Not per-organization
-- (this is SynqIQ's own prospective-customer pipeline, not a studio-tenant
-- concept), so no organization_id column, unlike almost every other table
-- in this schema.
--
-- RLS enabled with NO policies at all -- deliberately locked down to
-- service-role only. The submitting visitor is never authenticated (this
-- is a public marketing page, no SynqIQ session exists), so there's no
-- `authenticated`-role policy that could apply anyway; the insert goes
-- through app/api/leads/route.ts using the admin client, which is also the
-- only way to ever read this table back (no admin UI reads it yet -- the
-- table is meant to be queried directly in Supabase for now).
begin;

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  studio_name text not null,
  website text,
  phone text,
  email text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table leads enable row level security;

commit;
