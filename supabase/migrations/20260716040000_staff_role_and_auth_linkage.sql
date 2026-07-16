-- Real auth, step 1: staff.role and the staff<->auth.users linkage.
--
-- role is plain text + CHECK, not an enum -- consistent with this schema's
-- existing convention (substitution_requests.status does the same, for the
-- same reason: easier to extend later without ALTER TYPE). Default
-- 'instructor' so no data migration is needed here -- specific rows get
-- flipped to 'admin' by hand afterward, not derived from Mindbody (Mindbody
-- has no real role/permission concept on the staff record itself; the
-- closest thing, /staff/staffpermissions, only covers the minority of staff
-- who have an actual Mindbody software login, and requires one HTTP call
-- per staff member with no bulk option -- not something to sync from).
--
-- auth_user_id is nullable: not every staff row will have a login (most
-- instructors won't need one, mirroring what /staff/staffpermissions showed
-- empirically). UNIQUE enforces the 1:1 mapping at the DB level in both
-- directions. ON DELETE SET NULL, not CASCADE: losing an auth account
-- should never delete a staff member's schedule/request history, same
-- philosophy as the other optional FKs already in this schema (e.g.
-- class_occurrences.substitute_staff_id).
--
-- auth.users is a separate Supabase-managed schema that PostgREST doesn't
-- expose for embedded-resource joins the way public-schema tables are --
-- that's fine, nothing here ever needs to join through it. The lookup only
-- ever goes staff.auth_user_id = <session's auth user id>, resolved from
-- Supabase Auth directly, never the other way via a join.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'instructor'
    CHECK (role IN ('admin', 'instructor'));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL;
