-- Every FK column below had DEFAULT gen_random_uuid() -- almost certainly a
-- copy-paste from the id/PK column pattern applied to the wrong columns.
-- A FK column defaulting to a random UUID is never correct: on any insert
-- that omits the column, it silently generates a UUID that matches no real
-- row, either failing the FK check outright (as it just did for `rooms`,
-- discovered while wiring up the staff/departments/rooms MindBody sync) or,
-- worse, occasionally colliding with something if the FK were nullable with
-- a lenient constraint elsewhere.
--
-- Audited before applying: only three call sites in the whole codebase write
-- to these tables (Locations/rooms/staff, all in
-- app/api/sync/classes/route.ts), and none of them rely on the default --
-- they either supply the FK explicitly or expect NULL when omitted.
-- class_templates has zero call sites anywhere; its bogus defaults have never
-- been exercised.

BEGIN;

ALTER TABLE "Locations"
  ALTER COLUMN organization_id DROP DEFAULT;

ALTER TABLE class_templates
  ALTER COLUMN department_id DROP DEFAULT,
  ALTER COLUMN location_id DROP DEFAULT,
  ALTER COLUMN organization_id DROP DEFAULT,
  ALTER COLUMN primary_staff_id DROP DEFAULT,
  ALTER COLUMN room_id DROP DEFAULT;

ALTER TABLE rooms
  ALTER COLUMN location_id DROP DEFAULT;

ALTER TABLE staff
  ALTER COLUMN location_id DROP DEFAULT,
  ALTER COLUMN organization_id DROP DEFAULT;

COMMIT;
