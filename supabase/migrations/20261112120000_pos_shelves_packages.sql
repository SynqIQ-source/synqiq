-- POS, part 3: checkout layout and membership packages.
--
-- pos_groups: the checkout's "shelves" -- what staff tap through on the
-- checkout screen (Memberships -> packages; Drinks -> Energy drinks -> items).
-- Display only: revenue still posts by each item's revenue category, so a
-- shelf can mix categories (Drinks -> Water holds untaxed Water items).
-- Two levels: a top shelf, and shelves inside it.
--
-- Membership packages: a membership item can carry package_parts -- what the
-- first payment is made of, each part in its own revenue category, e.g.
-- 12 Month Commitment = Registration fee $200 (Registration Fee, once) +
-- Monthly dues $219 (Membership Dues, recurring). The sale records one line
-- per part so revenue lands in the right category, and the recurring parts
-- become the member's monthly payment schedule (member_billing_schedules).

create table if not exists pos_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  parent_id uuid references pos_groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pos_groups_org_idx on pos_groups (organization_id, parent_id, sort);

alter table pos_items add column if not exists group_id uuid references pos_groups (id) on delete set null;
-- [{label, revenueCategoryId, amountCents, recurring}]; parts add up to price_cents.
alter table pos_items add column if not exists package_parts jsonb;
-- Monthly payments after the first one (null = until cancelled).
alter table pos_items add column if not exists autopay_count integer check (autopay_count is null or autopay_count between 0 and 120);
alter table pos_items add column if not exists auto_renews boolean not null default false;

-- Sale lines that came from a package part.
alter table pos_sale_lines add column if not exists package_item_id uuid references pos_items (id);
alter table pos_sale_lines add column if not exists package_name text;
alter table pos_sale_lines add column if not exists recurring boolean not null default false;

create table if not exists member_billing_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  sale_id uuid not null references pos_sales (id) on delete cascade,
  pos_item_id uuid references pos_items (id),
  mindbody_client_id text not null,
  client_name text,
  name text not null,
  -- practice: from a practice sale (nothing is ever charged).
  status text not null default 'practice' check (status in ('practice', 'active', 'cancelled', 'voided')),
  start_date date not null,
  first_bill_date date not null, -- first monthly payment after the sale
  billing_interval text not null default 'month' check (billing_interval in ('month')),
  -- [{label, revenueCategoryId, revenueCategory, amountCents, taxable}]: dues only
  recurring_lines jsonb not null default '[]'::jsonb,
  recurring_subtotal_cents integer not null,
  recurring_tax_cents integer not null default 0,
  recurring_total_cents integer not null,
  autopay_count integer, -- null = until cancelled
  auto_renews boolean not null default false,
  created_at timestamptz not null default now(),
  voided_at timestamptz
);
create index if not exists member_billing_schedules_client_idx on member_billing_schedules (organization_id, mindbody_client_id);
create index if not exists member_billing_schedules_sale_idx on member_billing_schedules (sale_id);

alter table pos_groups enable row level security;
alter table member_billing_schedules enable row level security;

drop policy if exists "pos_groups_select_same_org" on pos_groups;
create policy "pos_groups_select_same_org" on pos_groups for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- Same as sales: Club Admins see all; others the schedules from sales they rang up.
drop policy if exists "member_billing_schedules_select" on member_billing_schedules;
create policy "member_billing_schedules_select" on member_billing_schedules for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      private.current_staff_role() = 'admin'
      or exists (select 1 from pos_sales s where s.id = sale_id and s.staff_id = private.current_staff_id())
    )
  );
