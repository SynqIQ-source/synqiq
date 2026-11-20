-- Prepaid sessions in SynqIQ (Adam, 2026-11-19): each member's session packs
-- (PT, intro workouts, class packs) with a balance SynqIQ keeps. Opening
-- balances come from Mindbody (member_services) and refresh nightly until the
-- studio's switch date; after that SynqIQ's count is the only one. Every
-- session used is its own row, never an overwrite.
create table if not exists session_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text,
  crm_contact_id uuid references crm_contacts (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('pt', 'intro', 'class')),
  program text,
  total_sessions integer not null check (total_sessions >= 0),
  opening_remaining integer not null check (opening_remaining >= 0),
  expires_on date,
  source text not null check (source in ('mindbody', 'synqiq')),
  mindbody_client_service_id text,
  pos_sale_id uuid references pos_sales (id) on delete set null,
  pos_item_id uuid references pos_items (id) on delete set null,
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  check (mindbody_client_id is not null or crm_contact_id is not null)
);
-- Full (not partial) so the Mindbody import can upsert on it; SynqIQ packs
-- have no Mindbody id (nulls don't collide).
create unique index if not exists session_packs_mindbody_key on session_packs (organization_id, mindbody_client_service_id);
create index if not exists session_packs_client_idx on session_packs (organization_id, mindbody_client_id);

create table if not exists session_pack_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  session_pack_id uuid not null references session_packs (id) on delete cascade,
  trainer_session_id uuid references trainer_sessions (id) on delete set null,
  kind text not null check (kind in ('completed', 'no_show', 'late_cancel', 'adjustment', 'refund')),
  sessions integer not null check (sessions <> 0), -- -1 uses one; positive gives back
  note text,
  staff_id uuid references staff (id),
  voided_at timestamptz,
  voided_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now()
);
create index if not exists session_pack_uses_pack_idx on session_pack_uses (session_pack_id) where voided_at is null;
-- One live use per session (a reopened session voids its use first).
create unique index if not exists session_pack_uses_session_key on session_pack_uses (trainer_session_id)
  where trainer_session_id is not null and voided_at is null;

alter table trainer_sessions add column if not exists session_pack_id uuid references session_packs (id) on delete set null;

-- When SynqIQ's balances stop refreshing from Mindbody (the studio's switch).
alter table organizations add column if not exists session_balances_from date not null default '2026-12-18';

-- Balance per pack: opening minus uses (voided uses don't count).
create or replace view public.session_pack_balances
with (security_invoker = true)
as
  select
    p.*,
    p.opening_remaining + coalesce((select sum(u.sessions) from session_pack_uses u where u.session_pack_id = p.id and u.voided_at is null), 0)
      as remaining
  from session_packs p;

alter table session_packs enable row level security;
alter table session_pack_uses enable row level security;
drop policy if exists session_packs_select_same_org on session_packs;
create policy session_packs_select_same_org on session_packs for select to authenticated
  using (organization_id = private.current_staff_org_id());
drop policy if exists session_pack_uses_select_same_org on session_pack_uses;
create policy session_pack_uses_select_same_org on session_pack_uses for select to authenticated
  using (organization_id = private.current_staff_org_id());
revoke all on public.session_pack_balances from anon;
grant select on public.session_pack_balances to authenticated, service_role;
