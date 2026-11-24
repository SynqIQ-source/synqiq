-- Classes cancelled in Mindbody (2026-11-24).
--
-- Mindbody keeps returning a cancelled class from /class/classes with
-- IsCanceled = true; a class deleted from the schedule stops coming back at
-- all. Both now set is_canceled, and SynqIQ hides the class everywhere
-- (schedule, sub requests, booking, reminders, payroll). The row is kept,
-- not deleted, so its sub requests and bookings stay intact, and a class
-- Mindbody reinstates comes back on the next sync. Additive only.

alter table public.class_occurrences
  add column if not exists is_canceled boolean not null default false;

comment on column public.class_occurrences.is_canceled is
  'True when Mindbody cancelled the class (IsCanceled) or removed it from the schedule. Set by the nightly class sync and the 15-minute counts refresh; hidden from every list.';
