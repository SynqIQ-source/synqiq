-- Trainer availability: the hours a trainer can be booked. Copied from
-- Mindbody's appointment availability (read only; refreshed nightly and on
-- demand) and added in SynqIQ by the trainer or a Club Admin. Anyone on staff
-- can book a trainer inside these hours.

create table if not exists trainer_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id) on delete cascade,
  source text not null check (source in ('mindbody', 'synqiq')),
  mindbody_availability_id bigint,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  session_type_ids integer[], -- Mindbody session types allowed in this block; null = any
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists trainer_availability_staff_idx on trainer_availability (organization_id, staff_id, starts_at);
create unique index if not exists trainer_availability_mindbody_idx
  on trainer_availability (organization_id, mindbody_availability_id, starts_at) where source = 'mindbody';

alter table trainer_availability enable row level security;
drop policy if exists "trainer_availability_select_same_org" on trainer_availability;
create policy "trainer_availability_select_same_org" on trainer_availability for select to authenticated
  using (organization_id = private.current_staff_org_id());

alter table organizations add column if not exists trainer_availability_synced_at timestamptz;
