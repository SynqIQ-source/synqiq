-- B3: booking people into classes on SynqIQ's calendar (class_sessions).
-- One row per person per class; re-booking reuses the row. Until the
-- switch nothing here goes to Mindbody (Mindbody's own bookings are counted
-- from its class sync and shown live on rosters). Staff of the studio can
-- read; the API writes with the service role after checking the role.
create table if not exists class_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  class_session_id uuid not null references class_sessions (id) on delete restrict,
  mindbody_client_id text not null,
  client_name text not null,
  status text not null check (status in ('booked', 'waitlisted', 'cancelled', 'late_cancelled', 'checked_in', 'no_show')),
  waitlisted_at timestamptz,
  coverage_kind text not null check (coverage_kind in ('membership', 'pack', 'none')),
  coverage_name text,
  mindbody_client_service_id bigint,
  note text,                       -- required when nothing covers it
  late_cancel_fee_cents integer,   -- the program's fee when late-cancelled (not charged yet)
  booked_at timestamptz not null default now(),
  booked_by_staff_id uuid references staff (id),
  cancelled_at timestamptz,
  cancelled_by_staff_id uuid references staff (id),
  cancel_reason text,
  checked_in_at timestamptz,
  checked_in_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  unique (class_session_id, mindbody_client_id)
);
create index if not exists class_bookings_session_idx on class_bookings (class_session_id, status);
create index if not exists class_bookings_client_idx on class_bookings (organization_id, mindbody_client_id);

alter table class_bookings enable row level security;
create policy "class_bookings_select_same_org" on class_bookings for select to authenticated
  using (organization_id = private.current_staff_org_id());
