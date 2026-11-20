-- "Take over the schedule" (Dec 18): when set, SynqIQ owns the studio's class
-- schedule and the nightly Mindbody catalog import leaves its categories,
-- rooms, classes and schedules alone (appointment types still import).
alter table organizations add column if not exists classes_taken_over_at timestamptz;
