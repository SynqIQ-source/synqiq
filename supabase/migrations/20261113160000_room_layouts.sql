-- Room layouts (pick-a-spot). A Club Admin designs a room on a grid: spots
-- (bikes, reformers, mats, lanes), the instructor, doors, windows, mirrors
-- and labels. Classes in a room with a layout let members choose a spot.
-- SynqIQ only; Mindbody isn't changed.

create table if not exists room_layouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  room_id uuid not null references rooms (id) on delete cascade,
  columns integer not null default 8 check (columns between 2 and 30),
  rows integer not null default 6 check (rows between 2 and 30),
  -- [{id, kind: spot|instructor|door|window|mirror|label, x, y, label}]
  items jsonb not null default '[]'::jsonb,
  spot_noun text not null default 'Spot', -- "Bike", "Reformer", "Lane"
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  unique (room_id)
);
create index if not exists room_layouts_org_idx on room_layouts (organization_id);

alter table class_bookings add column if not exists spot_id text;
alter table class_bookings add column if not exists spot_label text;
-- One person per spot per class (cancelled bookings free it).
create unique index if not exists class_bookings_spot_idx
  on class_bookings (class_session_id, spot_id)
  where spot_id is not null and status in ('booked', 'checked_in');

alter table room_layouts enable row level security;
drop policy if exists "room_layouts_select_same_org" on room_layouts;
create policy "room_layouts_select_same_org" on room_layouts for select to authenticated
  using (organization_id = private.current_staff_org_id());
