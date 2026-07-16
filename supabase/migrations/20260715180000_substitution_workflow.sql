-- ============================================================================
-- Sprint 4: substitution workflow schema
--
--   substitution_requests      -- a request to cover a specific class occurrence
--   substitution_interests     -- which qualified instructors said yes to covering it
--   instructor_class_eligibility -- admin-togglable per (staff, department, class_name)
--                                   qualification, seeded from 90 days of history
--
-- Design notes (see conversation history for the full discussion):
--
--   - substitution_requests.organization_id is a direct column, not derived via
--     occurrence_id -> class_occurrences.organization_id, mirroring how
--     class_occurrences itself carries organization_id directly. Keeps a future
--     RLS policy a plain organization_id check instead of a join.
--
--   - status is plain text + a CHECK constraint, not a Postgres enum type,
--     consistent with how the rest of this schema favors text over enums
--     (organizations.status, departments/rooms.active are the precedent) --
--     easier to extend later without an ALTER TYPE.
--
--   - instructor_class_eligibility has two FKs to staff (staff_id and
--     updated_by), same situation as class_occurrences' staff_id/
--     substitute_staff_id -- any future embedded-resource query against this
--     table needs an explicit FK-constraint hint to disambiguate, same as
--     already done for class_occurrences.
--
--   - class_name is stored trimmed here (source data has inconsistent
--     trailing whitespace, e.g. "Reformer Pilates " vs "Reformer Pilates",
--     confirmed in class_occurrences.class_name) -- this table doesn't
--     inherit that fragmentation, even though class_occurrences.class_name
--     itself is left as-is.
--
--   - The seed only inserts TRUE rows (instructor actually taught that
--     department+class_name combo in the last 90 days). Absence of a row
--     means "not eligible" by convention -- an eligibility check is a LEFT
--     JOIN + COALESCE(enabled, false), not a lookup requiring every row to
--     exist. A full cross-join (every staff x every taught combo, explicit
--     FALSE rows) was considered and rejected: with ~137 staff and ~30
--     distinct department+class_name combos that's 4,000+ rows, nearly all
--     of them noise nobody will ever toggle.
-- ============================================================================

BEGIN;

CREATE TABLE substitution_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES class_occurrences (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  requested_by uuid NOT NULL REFERENCES staff (id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending_selection', 'approved', 'completed', 'cancelled')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMENT ON TABLE substitution_requests IS
  'A request to cover a specific class_occurrences row. One occurrence may have multiple requests over time (e.g. re-opened after a cancelled approval), so no uniqueness constraint on occurrence_id.';

CREATE TABLE substitution_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES substitution_requests (id),
  staff_id uuid NOT NULL REFERENCES staff (id),
  expressed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, staff_id)
);

COMMENT ON TABLE substitution_interests IS
  'Which staff said yes to covering a given substitution_requests row. UNIQUE(request_id, staff_id) makes expressing interest idempotent.';

CREATE TABLE instructor_class_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff (id),
  department_id uuid NOT NULL REFERENCES departments (id),
  class_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES staff (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, department_id, class_name)
);

COMMENT ON TABLE instructor_class_eligibility IS
  'Admin-togglable per-instructor qualification for a (department, class_name) pair. Absence of a row means not eligible -- rows are only created when eligible at least once (seed) or explicitly toggled (admin action); check with LEFT JOIN + COALESCE(enabled, false), not a required lookup.';

COMMENT ON COLUMN instructor_class_eligibility.updated_by IS
  'Staff member who last toggled this row. NULL means system-seeded, never manually touched. Two FKs to staff exist on this table (staff_id, updated_by) -- embedded-resource queries need an explicit FK-constraint hint to disambiguate, same as class_occurrences.staff_id / substitute_staff_id.';

-- Seed: any instructor who actually taught a given (department, class_name)
-- combo in the last 90 days starts enabled=true. Everyone else simply has no
-- row (implicit false) rather than an explicit false row -- see notes above.
INSERT INTO instructor_class_eligibility (staff_id, department_id, class_name, enabled, updated_at)
SELECT DISTINCT
  staff_id,
  department_id,
  TRIM(class_name),
  true,
  now()
FROM class_occurrences
WHERE staff_id IS NOT NULL
  AND department_id IS NOT NULL
  AND class_name IS NOT NULL
  AND start_datetime >= now() - interval '90 days'
ON CONFLICT (staff_id, department_id, class_name) DO NOTHING;

COMMIT;
