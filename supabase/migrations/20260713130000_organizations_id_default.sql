-- organizations.id was missing DEFAULT gen_random_uuid(), unlike every other
-- table in the schema (Locations, class_occurrences, class_templates,
-- departments, rooms, staff all have it). Discovered when the class sync's
-- new organization upsert step failed with a NOT NULL violation on id.
-- Safe to apply directly: organizations has 0 rows.

ALTER TABLE organizations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
