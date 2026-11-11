-- C4 payroll, part 1: pay settings.
--
-- pay_rates are reusable rate templates a Club Admin names ("Peak Incentive",
-- "PT 65%", "Per class $30"). Classes use one formula: base + per_head for
-- each paid client above heads_above, capped at cap (a flat rate is just
-- per_head = 0). Appointments are paid either a percent of the session's
-- value (pack price / sessions) or a flat amount per session.
--
-- staff_pay_settings holds each person's hourly rate (paid on time clock
-- hours) and their default class / appointment rate. staff_pay_assignments
-- override the default for one class schedule, class type or session type
-- (most specific wins: schedule > class type > default).
--
-- Pay is sensitive: only Club Admins read everything; each person can read
-- their own settings. All writes go through the API (service role).

create table if not exists pay_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  applies_to text not null check (applies_to in ('class', 'appointment')),
  method text not null check (method in ('class_formula', 'percent', 'flat')),
  base_cents integer not null default 0 check (base_cents >= 0),
  per_head_cents integer not null default 0 check (per_head_cents >= 0),
  heads_above integer not null default 0 check (heads_above >= 0),
  cap_cents integer check (cap_cents is null or cap_cents >= 0),
  percent numeric(5, 2) check (percent is null or (percent >= 0 and percent <= 100)),
  flat_cents integer check (flat_cents is null or flat_cents >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  check (
    (applies_to = 'class' and method in ('class_formula', 'flat'))
    or (applies_to = 'appointment' and method in ('percent', 'flat'))
  ),
  check (method <> 'percent' or percent is not null),
  check (method <> 'flat' or flat_cents is not null)
);
create unique index if not exists pay_rates_org_name_idx on pay_rates (organization_id, lower(name)) where archived_at is null;

create table if not exists staff_pay_settings (
  staff_id uuid primary key references staff (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  class_rate_id uuid references pay_rates (id),
  appointment_rate_id uuid references pay_rates (id),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id)
);
create index if not exists staff_pay_settings_org_idx on staff_pay_settings (organization_id);

create table if not exists staff_pay_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  scope text not null check (scope in ('class_schedule', 'class_type', 'session_type')),
  mindbody_id bigint not null,
  label text, -- what it was set on, for display ("Svelte · Mon 5:30 PM")
  pay_rate_id uuid not null references pay_rates (id),
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  unique (staff_id, scope, mindbody_id)
);
create index if not exists staff_pay_assignments_org_idx on staff_pay_assignments (organization_id, staff_id);

alter table pay_rates enable row level security;
alter table staff_pay_settings enable row level security;
alter table staff_pay_assignments enable row level security;

drop policy if exists "pay_rates_select_admin" on pay_rates;
create policy "pay_rates_select_admin" on pay_rates for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

drop policy if exists "staff_pay_settings_select" on staff_pay_settings;
create policy "staff_pay_settings_select" on staff_pay_settings for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );

drop policy if exists "staff_pay_assignments_select" on staff_pay_assignments;
create policy "staff_pay_assignments_select" on staff_pay_assignments for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );
