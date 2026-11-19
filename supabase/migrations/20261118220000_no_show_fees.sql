-- No-show fees on class and pool lane bookings (Adam, 2026-11-18): marking
-- someone a no-show records the program's no-show fee, the same way a late
-- cancel records the late-cancel fee. Not charged yet; both feed the
-- No-shows & Late Cancels report.
alter table class_bookings add column if not exists no_show_fee_cents integer;
create index if not exists class_bookings_fees_idx on class_bookings (organization_id, status) where status in ('no_show', 'late_cancelled');
