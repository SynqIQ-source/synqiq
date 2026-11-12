-- Trainer calendar: sessions trainers (or the desk) book with clients in
-- SynqIQ. Completing one writes a payroll event for that day. SynqIQ only:
-- nothing is written to Mindbody. While Mindbody is still the system of
-- record (parallel run), payroll events are 'practice' and shown beside
-- Mindbody's sessions instead of being paid.

create table if not exists trainer_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  trainer_staff_id uuid not null references staff (id),
  mindbody_client_id text not null,
  client_name text not null,
  session_type_id integer, -- Mindbody session type id (session_types.mindbody_session_type_id)
  session_type_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  local_date date not null, -- studio date of starts_at
  status text not null default 'booked'
    check (status in ('booked', 'completed', 'no_show', 'cancelled', 'late_cancelled')),
  -- What pays for it, from the client's Mindbody services at booking.
  coverage_kind text not null default 'none' check (coverage_kind in ('pack', 'none')),
  coverage_name text,
  mindbody_client_service_id bigint,
  note text,
  booked_at timestamptz not null default now(),
  booked_by_staff_id uuid references staff (id),
  closed_at timestamptz, -- completed / no-show / cancelled
  closed_by_staff_id uuid references staff (id),
  cancel_reason text,
  updated_at timestamptz not null default now()
);
create index if not exists trainer_sessions_trainer_idx on trainer_sessions (organization_id, trainer_staff_id, starts_at);
create index if not exists trainer_sessions_date_idx on trainer_sessions (organization_id, local_date);
create index if not exists trainer_sessions_client_idx on trainer_sessions (organization_id, mindbody_client_id);

-- One row per thing that earns pay on a day. Today: completed (or charged
-- no-show) trainer sessions, with the value and rate snapshotted so later
-- rate changes don't change past pay.
create table if not exists payroll_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id),
  kind text not null check (kind in ('session')),
  trainer_session_id uuid references trainer_sessions (id) on delete cascade,
  work_date date not null,
  description text not null,
  client_name text,
  value_cents integer, -- the session's value (pack pre-tax price / sessions); null = unknown
  value_estimated boolean not null default false,
  value_source text, -- the pack it came from
  pay_rate_id uuid references pay_rates (id) on delete set null,
  pay_rate_name text,
  amount_cents integer not null default 0,
  no_show boolean not null default false,
  status text not null default 'practice' check (status in ('practice', 'live')),
  created_at timestamptz not null default now(),
  created_by_staff_id uuid references staff (id),
  voided_at timestamptz,
  voided_by_staff_id uuid references staff (id),
  void_reason text
);
create unique index if not exists payroll_events_session_live_idx on payroll_events (trainer_session_id) where voided_at is null;
create index if not exists payroll_events_staff_idx on payroll_events (organization_id, staff_id, work_date);
create index if not exists payroll_events_date_idx on payroll_events (organization_id, work_date);

alter table trainer_sessions enable row level security;
alter table payroll_events enable row level security;

-- Staff in the studio see the calendar (the desk books for trainers).
-- Writes go through the server (service role) after role checks.
drop policy if exists "trainer_sessions_select_same_org" on trainer_sessions;
create policy "trainer_sessions_select_same_org" on trainer_sessions for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- Pay: Club Admins see everyone's; a trainer sees their own.
drop policy if exists "payroll_events_select" on payroll_events;
create policy "payroll_events_select" on payroll_events for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or staff_id = private.current_staff_id())
  );
