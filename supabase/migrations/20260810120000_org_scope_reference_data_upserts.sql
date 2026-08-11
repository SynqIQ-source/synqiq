-- Cross-org data collision fix. staff, departments, "Locations", and rooms
-- all upserted on their raw MindBody id ALONE (mindbody_staff_id,
-- mindbody_program_id, mindbody_location_id, mindbody_resource_id) --
-- never scoped by organization_id, even on the three tables that already
-- had that column. MindBody assigns these ids independently per account,
-- so nothing prevented two different studios' entities from sharing a
-- number and silently overwriting each other's row (including its
-- organization_id) on every sync.
--
-- Confirmed this already happened, not just a risk: the sandbox account's
-- departments dropped from 11 to 5 rows, staff from 169 to 95, Locations
-- from 3 to 1 -- the "missing" rows weren't deleted, they were reassigned
-- to The Preserve's organization_id in place the moment a Preserve sync
-- hit a colliding raw id. rooms has no organization_id at all, so every
-- studio sees every room in the database with no boundary whatsoever.
--
-- class_occurrences / appointment_occurrences / sales have the identical
-- structural bug (unique on the raw mindbody_*_id alone despite already
-- having an organization_id column) -- confirmed no actual collision has
-- occurred there yet (the two accounts' id ranges don't overlap at all),
-- but fixed here too rather than leaving a known instance of the same bug
-- unpatched.
--
-- The data-level reconciliation (recreating the sandbox rows this
-- silently erased, and repointing sandbox's own dangling foreign keys to
-- them) is a separate one-time script, not part of this migration --
-- this migration only changes the constraints so it can't happen again.
begin;

alter table staff drop constraint staff_mindbody_staff_id_key;
alter table staff add constraint staff_org_mindbody_staff_id_key unique (organization_id, mindbody_staff_id);

alter table departments drop constraint departments_mindbody_program_id_key;
alter table departments add constraint departments_org_mindbody_program_id_key unique (organization_id, mindbody_program_id);

alter table "Locations" drop constraint locations_mindbody_location_id_key;
alter table "Locations" add constraint locations_org_mindbody_location_id_key unique (organization_id, mindbody_location_id);

alter table class_occurrences drop constraint class_occurrences_mindbody_occurrence_id_key;
alter table class_occurrences add constraint class_occurrences_org_mindbody_occurrence_id_key unique (organization_id, mindbody_occurrence_id);

alter table appointment_occurrences drop constraint appointment_occurrences_mindbody_appointment_id_key;
alter table appointment_occurrences add constraint appointment_occurrences_org_mindbody_appointment_id_key unique (organization_id, mindbody_appointment_id);

alter table sales drop constraint sales_mindbody_sale_id_key;
alter table sales add constraint sales_org_mindbody_sale_id_key unique (organization_id, mindbody_sale_id);

-- rooms: no organization_id existed to scope by at all. Added nullable
-- for now -- the one-time reconciliation script backfills every existing
-- row (both the clean-cut ones and the ones that need splitting into a
-- second, newly-created row for the org that got silently dispossessed),
-- then a follow-up migration adds the NOT NULL + composite unique
-- constraint once that data is clean. Doing both in one step here would
-- require the backfill to already be correct, which defeats the point of
-- reviewing the reconciliation plan first.
alter table rooms add column organization_id uuid references organizations (id);

commit;
