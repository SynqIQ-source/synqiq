-- class_occurrences.start_datetime has no paired end time -- the Schedule
-- and Sub Requests pages can only show a start time, not "start - end
-- (duration)". MindBody's GET /class/classes returns EndDateTime alongside
-- StartDateTime (confirmed against a live response), so there's a real
-- source to sync instead of guessing at a duration.
--
-- Nullable and not backfilled here -- existing rows only get a value once
-- app/api/sync/classes/route.ts re-syncs them (same upsert-by-
-- mindbody_occurrence_id path every row already went through for
-- start_datetime).

ALTER TABLE class_occurrences ADD COLUMN IF NOT EXISTS end_datetime timestamptz;
