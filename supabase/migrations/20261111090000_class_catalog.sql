-- The class catalog, imported from Mindbody so SynqIQ can take over
-- booking: rooms (existing `rooms`), programs with their booking rules
-- (existing `departments`), class types with descriptions, recurring class
-- schedules, and appointment/class session types. Mindbody stays the
-- source until the switch; each table has `edits` (SynqIQ changes that win
-- over Mindbody's copy, used from the next step on). Staff of the studio
-- can read the catalog; the service role writes it.

-- Programs: Mindbody's booking rules.
alter table departments add column if not exists schedule_type text;          -- Class / Appointment / Enrollment
alter table departments add column if not exists cancel_window_minutes integer; -- late cancel inside this many minutes
alter table departments add column if not exists booking_opens_days integer;     -- classes: clients can book this many days ahead
alter table departments add column if not exists booking_closes_minutes integer; -- online booking closes this long before start (appointments: minimum notice)
alter table departments add column if not exists paid_by jsonb not null default '[]'::jsonb;  -- [{id, name}] pricing categories that cover it
alter table departments add column if not exists pays_for jsonb not null default '[]'::jsonb;
alter table departments add column if not exists synced_at timestamptz;
alter table departments add column if not exists edits jsonb not null default '{}'::jsonb;

alter table rooms add column if not exists synced_at timestamptz;
alter table rooms add column if not exists edits jsonb not null default '{}'::jsonb;

create table if not exists class_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_class_description_id integer not null,
  name text not null,
  description_html text,
  description_text text,
  image_url text,
  level text,
  notes text,
  prerequisites text,
  mindbody_program_id integer,
  mindbody_session_type_id integer,
  category text,
  subcategory text,
  active boolean not null default true,
  mindbody_updated_at timestamp,
  synced_at timestamptz not null default now(),
  edits jsonb not null default '{}'::jsonb,
  unique (organization_id, mindbody_class_description_id)
);

create table if not exists class_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_class_schedule_id integer not null,
  mindbody_class_description_id integer,
  class_name text,
  days smallint[] not null default '{}', -- 0 = Sunday ... 6 = Saturday
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  staff_mindbody_id bigint,
  mindbody_location_id integer,
  frequency_type text,
  frequency_interval integer,
  is_available boolean,
  -- From the schedule's latest class (Mindbody's schedule doesn't carry them).
  mindbody_resource_id integer,
  capacity integer,
  web_capacity integer,
  last_class_at timestamptz,
  synced_at timestamptz not null default now(),
  edits jsonb not null default '{}'::jsonb,
  unique (organization_id, mindbody_class_schedule_id)
);
create index if not exists class_schedules_type_idx on class_schedules (organization_id, mindbody_class_description_id);

create table if not exists session_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_session_type_id integer not null,
  name text not null,
  kind text,                       -- Class / Appointment / All
  default_minutes integer,
  mindbody_program_id integer,
  sessions_deducted integer,
  online_description text,
  available_online boolean,        -- Mindbody's AvailableForAddOn
  resource_required boolean,
  synced_at timestamptz not null default now(),
  edits jsonb not null default '{}'::jsonb,
  unique (organization_id, mindbody_session_type_id)
);

alter table class_types enable row level security;
alter table class_schedules enable row level security;
alter table session_types enable row level security;

create policy "class_types_select_same_org" on class_types for select to authenticated
  using (organization_id = private.current_staff_org_id());
create policy "class_schedules_select_same_org" on class_schedules for select to authenticated
  using (organization_id = private.current_staff_org_id());
create policy "session_types_select_same_org" on session_types for select to authenticated
  using (organization_id = private.current_staff_org_id());
