-- Dec 10 transition (Adam, 2026-11-19): while members can still book in the
-- Mindbody app (through Dec 31), bookings made in SynqIQ are copied into
-- Mindbody so its class capacity stays right. Approved Mindbody write; off
-- until a Club Admin turns it on, and never after the cut-off date
-- (2027-01-21, when Mindbody API access ends).
alter table organizations add column if not exists mindbody_booking_writeback boolean not null default false;
alter table organizations add column if not exists mindbody_writeback_until date not null default '2027-01-21';

-- Per booking: what Mindbody has for it ('in' booked, 'waitlist', 'out'),
-- and whether SynqIQ still needs to push a change.
alter table class_bookings add column if not exists mindbody_sync_status text
  check (mindbody_sync_status is null or mindbody_sync_status in ('pending', 'synced', 'failed', 'skipped'));
alter table class_bookings add column if not exists mindbody_synced_state text
  check (mindbody_synced_state is null or mindbody_synced_state in ('in', 'waitlist', 'out'));
alter table class_bookings add column if not exists mindbody_synced_at timestamptz;
alter table class_bookings add column if not exists mindbody_sync_error text;
alter table class_bookings add column if not exists mindbody_sync_attempts integer not null default 0;
create index if not exists class_bookings_mindbody_pending_idx on class_bookings (organization_id) where mindbody_sync_status = 'pending';

-- Any new booking or status change needs pushing (the push job decides what,
-- if anything, Mindbody needs).
create or replace function private.mark_booking_for_mindbody()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.mindbody_sync_status := 'pending';
    new.mindbody_sync_attempts := 0;
    new.mindbody_sync_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists class_bookings_mark_for_mindbody on class_bookings;
create trigger class_bookings_mark_for_mindbody
  before insert or update of status on class_bookings
  for each row execute function private.mark_booking_for_mindbody();

-- When Mindbody's booked counts were last read for a class (nightly sync or
-- the 15-minute refresh), to avoid counting pushed SynqIQ bookings twice.
alter table class_occurrences add column if not exists counts_read_at timestamptz;
