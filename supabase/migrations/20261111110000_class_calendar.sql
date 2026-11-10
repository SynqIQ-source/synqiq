-- C3: SynqIQ's own class calendar.
--
-- 1. Class types and class times can be created in SynqIQ (source =
--    'synqiq', no Mindbody id). Mindbody's import never touches them.
-- 2. class_sessions: one row per class per date, generated from the
--    schedules (with SynqIQ edits) for the booking window. A single date
--    can be changed or cancelled (`edits`) without touching the weekly
--    pattern. Booking will hang off these rows.

alter table class_types alter column mindbody_class_description_id drop not null;
alter table class_types add column if not exists source text not null default 'mindbody' check (source in ('mindbody', 'synqiq'));
alter table class_types add column if not exists created_by_staff_id uuid references staff (id);

alter table class_schedules alter column mindbody_class_schedule_id drop not null;
alter table class_schedules add column if not exists source text not null default 'mindbody' check (source in ('mindbody', 'synqiq'));
alter table class_schedules add column if not exists class_type_id uuid references class_types (id) on delete set null;
alter table class_schedules add column if not exists created_by_staff_id uuid references staff (id);

-- Link Mindbody's schedules to their class type row.
update class_schedules s
set class_type_id = t.id
from class_types t
where s.class_type_id is null
  and t.organization_id = s.organization_id
  and t.mindbody_class_description_id = s.mindbody_class_description_id;

create table if not exists class_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  class_schedule_id uuid not null references class_schedules (id) on delete cascade,
  class_type_id uuid references class_types (id) on delete set null,
  class_name text not null,
  local_date date not null,
  start_time time not null, -- studio-local
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mindbody_resource_id integer,
  capacity integer,
  staff_mindbody_id bigint,
  mindbody_class_schedule_id integer, -- to compare with Mindbody's calendar
  generated_at timestamptz not null default now(),
  -- The weekly pattern no longer includes this date (kept when it had
  -- edits or, later, bookings).
  removed_from_schedule_at timestamptz,
  edits jsonb not null default '{}'::jsonb,
  unique (class_schedule_id, local_date)
);
create index if not exists class_sessions_date_idx on class_sessions (organization_id, local_date);
create index if not exists class_sessions_starts_idx on class_sessions (organization_id, starts_at);

alter table class_sessions enable row level security;
create policy "class_sessions_select_same_org" on class_sessions for select to authenticated
  using (organization_id = private.current_staff_org_id());

alter table catalog_edits drop constraint if exists catalog_edits_entity_check;
alter table catalog_edits add constraint catalog_edits_entity_check
  check (entity in ('class_type', 'class_schedule', 'room', 'program', 'session_type', 'class_session'));
