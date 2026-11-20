-- Schedule editor (Adam, 2026-11-19): class times made in SynqIQ link staff
-- and rooms by SynqIQ id (Mindbody ids kept only for mapping), and carry an
-- optional assistant instructor, pay overrides, a spot layout, waitlist and
-- online limits, and free / pay-later. Each generated date copies them.
alter table class_schedules
  add column if not exists staff_id uuid references staff (id) on delete set null,
  add column if not exists assistant_staff_id uuid references staff (id) on delete set null,
  add column if not exists room_id uuid references rooms (id) on delete set null,
  add column if not exists layout_id uuid references room_layouts (id) on delete set null,
  add column if not exists pay_override_cents integer check (pay_override_cents is null or pay_override_cents between 0 and 100000),
  add column if not exists assistant_pay_cents integer check (assistant_pay_cents is null or assistant_pay_cents between 0 and 100000),
  add column if not exists waitlist_capacity integer check (waitlist_capacity is null or waitlist_capacity between 0 and 200),
  add column if not exists online_capacity integer check (online_capacity is null or online_capacity between 0 and 500),
  add column if not exists is_free boolean not null default false,
  add column if not exists pay_later boolean not null default false;

alter table class_sessions
  add column if not exists staff_id uuid references staff (id) on delete set null,
  add column if not exists assistant_staff_id uuid references staff (id) on delete set null,
  add column if not exists layout_id uuid references room_layouts (id) on delete set null,
  add column if not exists pay_override_cents integer,
  add column if not exists assistant_pay_cents integer,
  add column if not exists waitlist_capacity integer,
  add column if not exists online_capacity integer,
  add column if not exists is_free boolean not null default false,
  add column if not exists pay_later boolean not null default false;

create index if not exists class_sessions_staff_idx on class_sessions (organization_id, staff_id) where staff_id is not null;
create index if not exists class_sessions_assistant_idx on class_sessions (organization_id, assistant_staff_id) where assistant_staff_id is not null;
