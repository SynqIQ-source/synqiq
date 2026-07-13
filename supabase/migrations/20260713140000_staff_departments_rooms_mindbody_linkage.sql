-- ============================================================================
-- Migration: add MindBody linkage columns for Locations/rooms/departments/staff
-- so the sync route can idempotently resolve/create these records instead of
-- always writing NULL FKs onto class_occurrences.
--
-- Findings that shaped this (see conversation history):
--
--   - Locations and rooms had no MindBody id column at all -- no way to
--     upsert them idempotently. Adding mindbody_location_id / mindbody_resource_id,
--     sourced from GET /site/locations and GET /site/resources respectively.
--
--   - departments.mindbody_service_category_id was named for MindBody's
--     Category concept (GET /site/categories), but ClassDescription.CategoryId
--     is null on every sampled class (0/200) -- using it would leave
--     class_occurrences.department_id null forever. ClassDescription.Program
--     (Membership, Yoga, Boot Camp, etc.) is what actually distinguishes
--     classes and is always populated, so departments now also gets
--     mindbody_program_id as the real resolvable source.
--     mindbody_service_category_id is left in place, unused, rather than
--     repurposed/removed -- categories may become useful later, but they
--     aren't what "department" means in practice for this data.
--
--   - staff.location_id was NOT NULL, but MindBody's /staff/staff has no
--     location concept: filtering by LocationIds=1 vs LocationIds=2 returned
--     the identical 141 staff. Made nullable to match reality (and how
--     departments.location_id / rooms.location_id already work).
-- ============================================================================

BEGIN;

ALTER TABLE "Locations"
  ADD COLUMN mindbody_location_id integer;

COMMENT ON COLUMN "Locations".mindbody_location_id IS
  'MindBody Location.Id (GET /site/locations). Unique per location.';

ALTER TABLE "Locations"
  ADD CONSTRAINT locations_mindbody_location_id_key UNIQUE (mindbody_location_id);

ALTER TABLE rooms
  ADD COLUMN mindbody_resource_id integer;

COMMENT ON COLUMN rooms.mindbody_resource_id IS
  'MindBody Resource.Id (GET /site/resources, also embedded as Classes[].Resource). Unique per resource.';

ALTER TABLE rooms
  ADD CONSTRAINT rooms_mindbody_resource_id_key UNIQUE (mindbody_resource_id);

ALTER TABLE departments
  ADD COLUMN mindbody_program_id integer;

COMMENT ON COLUMN departments.mindbody_program_id IS
  'MindBody Program.Id (ClassDescription.Program, via GET /class/classdescriptions). The real source for "department" -- always populated, unlike mindbody_service_category_id.';

ALTER TABLE departments
  ADD CONSTRAINT departments_mindbody_program_id_key UNIQUE (mindbody_program_id);

ALTER TABLE staff
  ADD CONSTRAINT staff_mindbody_staff_id_key UNIQUE (mindbody_staff_id);

ALTER TABLE staff
  ALTER COLUMN location_id DROP NOT NULL;

COMMIT;
