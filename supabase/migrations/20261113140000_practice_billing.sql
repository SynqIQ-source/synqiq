-- Billing test: members whose Mindbody contracts are imported into SynqIQ
-- payment schedules, with a practice charge recorded on every billing date
-- and checked against what Mindbody actually charged. Nothing is charged.

-- Imported schedules live beside POS ones; they have no SynqIQ sale.
alter table member_billing_schedules alter column sale_id drop not null;
alter table member_billing_schedules add column if not exists source text not null default 'pos';
alter table member_billing_schedules drop constraint if exists member_billing_schedules_source_check;
alter table member_billing_schedules add constraint member_billing_schedules_source_check check (source in ('pos', 'mindbody'));
alter table member_billing_schedules add column if not exists mindbody_client_contract_id bigint;
alter table member_billing_schedules add column if not exists end_date date;
create unique index if not exists member_billing_schedules_mindbody_contract_idx
  on member_billing_schedules (organization_id, mindbody_client_contract_id) where source = 'mindbody';

create table if not exists billing_test_members (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  added_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  primary key (organization_id, mindbody_client_id)
);

create table if not exists practice_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  schedule_id uuid not null references member_billing_schedules (id) on delete cascade,
  mindbody_client_id text not null,
  due_date date not null,
  subtotal_cents integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  result text not null default 'pending'
    check (result in ('pending', 'match', 'date_differs', 'amount_differs', 'not_charged')),
  mindbody_sale_detail_id bigint,
  mindbody_total_cents integer,
  mindbody_charged_on date,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  unique (schedule_id, due_date)
);
create index if not exists practice_charges_client_idx on practice_charges (organization_id, mindbody_client_id, due_date);

alter table billing_test_members enable row level security;
alter table practice_charges enable row level security;

-- Club Admins only; writes go through the server.
drop policy if exists "billing_test_members_select_admin" on billing_test_members;
create policy "billing_test_members_select_admin" on billing_test_members for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "practice_charges_select_admin" on practice_charges;
create policy "practice_charges_select_admin" on practice_charges for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
