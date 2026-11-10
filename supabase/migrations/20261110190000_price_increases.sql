-- Bulk % price increases for memberships, scheduled for a date on or after
-- the studio's billing cutover (when SynqIQ takes over charging from
-- Mindbody). Until then they only change what SynqIQ's previews say it
-- would charge. Each increase keeps the members it covers (old -> new
-- dues), the notice-email draft (never sent from here), who scheduled it
-- and who cancelled it. Club Admins only.

alter table organizations add column if not exists billing_cutover_date date not null default '2027-02-01';

create table if not exists price_increases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  percent numeric(5, 2) not null check (percent > 0 and percent <= 100),
  round_to_dollar boolean not null default false,
  effective_on date not null,
  -- The search used: {originalStartFrom, originalStartTo, plans[], priceMinCents, priceMaxCents}
  filters jsonb not null default '{}'::jsonb,
  notice_subject text,
  notice_body text,
  member_count integer not null default 0,
  created_by_staff_id uuid not null references staff (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references staff (id),
  cancel_reason text
);

create table if not exists price_increase_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  price_increase_id uuid not null references price_increases (id) on delete cascade,
  member_contract_id uuid references member_contracts (id) on delete set null,
  mindbody_client_contract_id bigint not null,
  mindbody_client_id text not null,
  contract_name text not null,
  original_start_date date,
  old_cents integer not null check (old_cents > 0), -- dues before tax
  new_cents integer not null check (new_cents >= old_cents),
  unique (price_increase_id, mindbody_client_contract_id)
);

create index if not exists price_increase_items_contract_idx on price_increase_items (organization_id, mindbody_client_contract_id);
create index if not exists price_increase_items_client_idx on price_increase_items (organization_id, mindbody_client_id);

alter table price_increases enable row level security;
alter table price_increase_items enable row level security;

create policy "price_increases_select_club_admin" on price_increases for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "price_increases_insert_club_admin" on price_increases for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "price_increases_update_club_admin" on price_increases for update to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin')
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

create policy "price_increase_items_select_club_admin" on price_increase_items for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "price_increase_items_insert_club_admin" on price_increase_items for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
