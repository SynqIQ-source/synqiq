-- Monthly renewals become sales (Adam, 2026-11-19) so dues show in the sales
-- reports, revenue categories and the member's purchases. A renewal sale has
-- no staff member (source = 'renewal').
alter table pos_sales alter column staff_id drop not null;
alter table pos_sales add column if not exists source text not null default 'pos';
alter table pos_sales drop constraint if exists pos_sales_source_check;
alter table pos_sales add constraint pos_sales_source_check check (source in ('pos', 'renewal'));

-- Declines: Club Admins can retry a charge now or move its date once (e.g.
-- the member reported fraud and is getting a new card). A moved date starts
-- the 3/6/10-day retries over from the new date.
alter table membership_charges add column if not exists retry_from date;
alter table membership_charges add column if not exists retry_base_attempts integer not null default 0;
alter table membership_charges add column if not exists moved_by_staff_id uuid references staff (id);
alter table membership_charges add column if not exists moved_at timestamptz;
alter table membership_charges add column if not exists decline_emailed_at timestamptz;
alter table membership_charges add column if not exists frozen_emailed_at timestamptz;
