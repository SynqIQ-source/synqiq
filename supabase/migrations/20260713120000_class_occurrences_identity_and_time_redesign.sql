-- ============================================================================
-- Migration: class_occurrences identity, org/timezone linkage, and time-field
-- redesign.
--
-- Background (see conversation history for full investigation):
--
--   1. `mindbody_class_schedule_id` currently stores MindBody's ClassScheduleId,
--      which identifies a *recurring series*, not a single class instance. The
--      sync route upserts on this column (onConflict: "mindbody_class_schedule_id"),
--      so every occurrence of a recurring class collapses onto one row.
--      MindBody's per-occurrence identifier is the top-level `Id` field returned
--      by GET /class/classes, confirmed stable across re-fetches and globally
--      unique across locations/resources/site ids.
--
--   2. `class_occurrences.start_time` is a naive copy of MindBody's StartDateTime
--      (confirmed by comparing live API output to stored rows) -- i.e. studio
--      local wall-clock time, NOT UTC. MindBody exposes the studio's timezone
--      as an IANA zone name via GET /site/sites -> Sites[0].TimeZone (one value
--      per MindBody site/subscriber, not per individual Location). Converting
--      naive local times to a correct timestamptz requires knowing which
--      organization (== MindBody site) a row belongs to.
--
--   3. Neither `organizations` nor `class_occurrences` currently has a reliable
--      link to identify which MindBody site/org a row came from -- department_id
--      and room_id are hardcoded to NULL by the sync route today. Both tables
--      are currently empty/stale in this environment, so there is nothing
--      meaningful to backfill; this migration adds the columns and constraints,
--      and leaves population to a corrected sync (out of scope for this file).
--
-- Pre-flight (run manually first; this migration does not do it for you):
--   Confirm the actual name of the existing unique constraint/index backing
--   today's upsert, since PostgREST's OpenAPI introspection does not surface
--   unique constraints:
--
--     SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--     WHERE conrelid = 'class_occurrences'::regclass
--       AND contype IN ('u', 'p');
--
--   Update the DROP CONSTRAINT name in step 2a below if it differs.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. organizations: link to the MindBody site this org syncs from, and store
--    its authoritative timezone (from GET /site/sites -> TimeZone). Both
--    nullable -- organizations has 0 rows today, and these are populated by
--    application code (a corrected sync step), not by this migration.
-- ----------------------------------------------------------------------------

ALTER TABLE organizations
  ADD COLUMN mindbody_site_id integer,
  ADD COLUMN timezone text;

COMMENT ON COLUMN organizations.mindbody_site_id IS
  'MindBody Site.Id (GET /site/sites) this organization syncs from. Corresponds to the MINDBODY_SITE_ID env var for a given deployment.';

COMMENT ON COLUMN organizations.timezone IS
  'IANA timezone name (e.g. America/Chicago) from MindBody Site.TimeZone. One value per MindBody site -- used to interpret every naive local timestamp MindBody returns for this org''s classes.';

ALTER TABLE organizations
  ADD CONSTRAINT organizations_mindbody_site_id_key UNIQUE (mindbody_site_id);

-- ----------------------------------------------------------------------------
-- 2. class_occurrences identity: add mindbody_occurrence_id as the true unique
--    per-occurrence key; demote mindbody_class_schedule_id to a non-unique
--    series reference. Add organization_id so each row can be resolved back
--    to its org's timezone.
-- ----------------------------------------------------------------------------

ALTER TABLE class_occurrences
  ADD COLUMN mindbody_occurrence_id bigint,
  ADD COLUMN organization_id uuid REFERENCES organizations (id);

COMMENT ON COLUMN class_occurrences.mindbody_occurrence_id IS
  'MindBody class instance id (GET /class/classes[].Id). Unique per occurrence, stable across re-syncs. This is the row identity key.';

COMMENT ON COLUMN class_occurrences.mindbody_class_schedule_id IS
  'MindBody recurring series id (GET /class/classes[].ClassScheduleId). Shared by every occurrence of the same recurring class. NOT unique per row -- do not use for upsert/identity.';

-- 2a. Drop the old unique constraint keyed on the series id. Replace the name
--     below if the pre-flight query above returned something different.
ALTER TABLE class_occurrences
  DROP CONSTRAINT IF EXISTS class_occurrences_mindbody_class_schedule_id_key;

-- If it was a unique index rather than a table constraint, drop it instead:
-- DROP INDEX IF EXISTS class_occurrences_mindbody_class_schedule_id_key;

-- 2b. It's now just a reference column, no longer required to be unique or NOT NULL.
ALTER TABLE class_occurrences
  ALTER COLUMN mindbody_class_schedule_id DROP NOT NULL;

-- 2c. Enforce uniqueness on the new occurrence id. A standard UNIQUE constraint
--     permits multiple NULLs, so this is safe to add before a corrected sync
--     backfills every row.
ALTER TABLE class_occurrences
  ADD CONSTRAINT class_occurrences_mindbody_occurrence_id_key UNIQUE (mindbody_occurrence_id);

-- 2d. Once a full re-sync has populated every row, run separately (will fail
--     until then):
-- ALTER TABLE class_occurrences ALTER COLUMN mindbody_occurrence_id SET NOT NULL;
-- ALTER TABLE class_occurrences ALTER COLUMN organization_id SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Add the missing FK on substitute_staff_id (staff_id already has one).
-- ----------------------------------------------------------------------------

ALTER TABLE class_occurrences
  ADD CONSTRAINT class_occurrences_substitute_staff_id_fkey
  FOREIGN KEY (substitute_staff_id) REFERENCES staff (id);

-- ----------------------------------------------------------------------------
-- 4. Time fields: consolidate start_time (timestamp, no tz) + class_date (date)
--    + class_time (time) into one canonical start_datetime timestamptz.
--
--    No blanket backfill UPDATE: start_time is naive studio-local time, and
--    there is no reliable per-row organization_id (hence timezone) to convert
--    it with yet -- guessing a single timezone here would silently corrupt
--    data the same way the current bug does. Existing rows get NULL and are
--    expected to be re-synced once the sync route resolves org -> timezone
--    before writing (see code changes below).
--
--    class_date / class_time / day_of_week are not read or written anywhere
--    in the current app (verified: only app/api/sync/classes/route.ts writes
--    start_time; nothing queries the other three) -- dropped outright rather
--    than kept as generated columns. See the commented block at the end for
--    how to add them back if a future feature needs calendar-date/wall-clock
--    filtering.
-- ----------------------------------------------------------------------------

ALTER TABLE class_occurrences
  ADD COLUMN start_datetime timestamptz;

ALTER TABLE class_occurrences
  DROP COLUMN start_time,
  DROP COLUMN class_date,
  DROP COLUMN class_time,
  DROP COLUMN day_of_week;

-- NOT NULL deferred until a corrected sync has backfilled every row:
-- ALTER TABLE class_occurrences ALTER COLUMN start_datetime SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 4a. OPTIONAL -- only uncomment if/when a feature needs to query by calendar
--     date or wall-clock time independent of full timestamp math.
-- ----------------------------------------------------------------------------
-- ALTER TABLE class_occurrences
--   ADD COLUMN class_date date GENERATED ALWAYS AS ((start_datetime AT TIME ZONE 'UTC')::date) STORED,
--   ADD COLUMN class_time time GENERATED ALWAYS AS ((start_datetime AT TIME ZONE 'UTC')::time) STORED,
--   ADD COLUMN day_of_week smallint GENERATED ALWAYS AS (EXTRACT(ISODOW FROM start_datetime AT TIME ZONE 'UTC')::smallint) STORED;

COMMIT;
