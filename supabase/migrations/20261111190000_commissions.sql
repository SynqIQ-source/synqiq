-- C4 payroll, part 2: sales commission.
--
-- Every product or service sold gets a commission category (commission_items,
-- keyed by Mindbody product id). Commission plans hold rules: for a category,
-- a percent of the PRE-TAX line amount and/or a flat amount per unit, with a
-- condition (any sale, new membership only, PT package to a client with no PT
-- in N months, or a trainer handoff a Club Admin approved on the sale).
-- A person's plan comes from staff_pay_settings, else the plan that defaults
-- to their role (or to trainers); commission can be switched off per person.
--
-- commission_lines is the snapshot payroll pays from: one row per sale line
-- per person, with the base, rate and amount used at the time. Later rate
-- changes never rewrite it. A returned line adds a negative clawback row.

create table if not exists commission_items (
  organization_id uuid not null references organizations (id) on delete cascade,
  product_id bigint not null,
  name text not null,
  category text not null default 'none'
    check (category in ('membership', 'enrollment_fee', 'pt_package', 'retail', 'other', 'none')),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  primary key (organization_id, product_id)
);

create table if not exists commission_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  default_roles text[] not null default '{}', -- staff roles that get this plan unless set per person
  default_trainers boolean not null default false, -- people tagged Trainer get it (after role defaults)
  default_enabled boolean not null default true,
  earn_on text not null default 'sale' check (earn_on in ('sale', 'payment')), -- 'payment' = per installment (future)
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  plan_id uuid not null references commission_plans (id) on delete cascade,
  category text not null check (category in ('membership', 'enrollment_fee', 'pt_package', 'retail', 'other')),
  condition text not null default 'any' check (condition in ('any', 'new_membership', 'new_pt_client', 'handoff')),
  percent numeric(5, 2) check (percent is null or (percent >= 0 and percent <= 100)),
  flat_cents integer check (flat_cents is null or flat_cents >= 0),
  created_at timestamptz not null default now(),
  check (percent is not null or flat_cents is not null),
  unique (plan_id, category, condition)
);

alter table organizations add column if not exists commission_new_pt_months integer not null default 6
  check (commission_new_pt_months between 1 and 36);

alter table staff_pay_settings add column if not exists commission_plan_id uuid references commission_plans (id);
alter table staff_pay_settings add column if not exists commission_enabled boolean; -- null = the plan's default

create table if not exists commission_sale_flags (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_sale_detail_id bigint not null,
  handoff_approved boolean not null default false,
  note text,
  set_at timestamptz not null default now(),
  set_by_staff_id uuid references staff (id),
  primary key (organization_id, mindbody_sale_detail_id)
);

create table if not exists commission_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id),
  kind text not null check (kind in ('earn', 'clawback')),
  mindbody_sale_id bigint not null,
  mindbody_sale_detail_id bigint not null,
  mindbody_client_id text,
  sale_at timestamptz not null,
  earned_at timestamptz not null, -- sale time for earn; when the return was seen for clawback
  description text not null,
  category text not null,
  condition text not null,
  plan_id uuid references commission_plans (id),
  rule_id uuid references commission_rules (id) on delete set null,
  quantity numeric(10, 2) not null default 1,
  base_cents integer not null, -- pre-tax line amount
  percent numeric(5, 2),
  flat_cents integer,
  amount_cents integer not null, -- negative for clawback
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_sale_detail_id, staff_id, kind)
);
create index if not exists commission_lines_org_earned_idx on commission_lines (organization_id, earned_at);
create index if not exists commission_lines_staff_idx on commission_lines (organization_id, staff_id, earned_at);

alter table commission_items enable row level security;
alter table commission_plans enable row level security;
alter table commission_rules enable row level security;
alter table commission_sale_flags enable row level security;
alter table commission_lines enable row level security;

drop policy if exists "commission_items_select_admin" on commission_items;
create policy "commission_items_select_admin" on commission_items for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "commission_plans_select_admin" on commission_plans;
create policy "commission_plans_select_admin" on commission_plans for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "commission_rules_select_admin" on commission_rules;
create policy "commission_rules_select_admin" on commission_rules for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "commission_sale_flags_select_admin" on commission_sale_flags;
create policy "commission_sale_flags_select_admin" on commission_sale_flags for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists "commission_lines_select" on commission_lines;
create policy "commission_lines_select" on commission_lines for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );
