-- Facility Tech tag (Staff & Roles): combines with any role. Facility Techs
-- get every maintenance email (and critical alerts), add notes, run every
-- maintenance report (troubleshooting, visits, on site, resolved) and keep
-- the equipment register. Vendor contact and quote/paid amounts stay with
-- Club Admins.
alter table staff add column if not exists is_facility_tech boolean not null default false;
