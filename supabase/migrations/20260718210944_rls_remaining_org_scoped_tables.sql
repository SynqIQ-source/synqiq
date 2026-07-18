-- Wrapped in BEGIN/COMMIT: the Supabase SQL Editor autocommits each
-- statement individually otherwise, so a mid-script failure (e.g. a typo in
-- statement 5) would leave the statements before it permanently applied
-- with no rollback. This makes the whole file atomic -- either all 8
-- ALTER TABLE/CREATE POLICY statements land, or none do.
begin;

-- Second RLS pass, covering the 7 tables that were already RLS-enabled but
-- policy-less (locked to everyone but service-role): organizations, staff,
-- "Locations", departments, rooms, class_templates, class_occurrences.
-- Unlike the previous migration (20260718205354), these tables were never
-- exposed -- this is a design/rollout pass, not closing a live gap. Reuses
-- the private.current_staff_id/current_staff_org_id/current_staff_role/
-- staff_org_id helpers created there.
--
-- Two deliberate compromises, both accepted for now rather than blocking on
-- a data backfill:
--
-- 1. departments and rooms have no organization_id column of their own. The
--    only path to an org (location_id -> "Locations".organization_id) is
--    NULL on every single row today, so a strict org-scoped join policy
--    would return zero rows to everyone and break every dashboard page that
--    embeds department/room (schedule, sub-requests, substitutions,
--    classes, heatmap all do). Their policies below grant read access to
--    any authenticated staff member instead of true org-scoping. This is
--    only meaningfully different from real org-scoping once a second
--    organization exists -- fine for the current single-org sandbox, same
--    caveat already called out in this codebase's other "single-org
--    sandbox" comments. Revisit once location_id is backfilled.
--
-- 2. class_occurrences.organization_id is NULL on 14 of ~3941 rows. Those
--    14 rows are invisible under the org-scoped SELECT policy below to
--    everyone except the service-role client -- accepted as-is rather than
--    backfilling first.

-- === organizations ===========================================================

alter table organizations enable row level security;

create policy "organizations_select_own"
  on organizations for select
  to authenticated
  using (id = private.current_staff_org_id());

-- === staff ====================================================================

alter table staff enable row level security;

create policy "staff_select_same_org"
  on staff for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- === "Locations" ==============================================================

alter table "Locations" enable row level security;

create policy "locations_select_same_org"
  on "Locations" for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- === departments ==============================================================
-- See compromise #1 above: no reliable org link today, so this is
-- "any recognized staff member," not true org-scoping.

alter table departments enable row level security;

create policy "departments_select_any_authenticated_staff"
  on departments for select
  to authenticated
  using (private.current_staff_id() is not null);

-- === rooms ====================================================================
-- Same compromise as departments.

alter table rooms enable row level security;

create policy "rooms_select_any_authenticated_staff"
  on rooms for select
  to authenticated
  using (private.current_staff_id() is not null);

-- === class_templates ==========================================================
-- Unlike departments/rooms, this table has a real organization_id column,
-- so it gets proper org-scoping even though it's currently unused (0 rows).

alter table class_templates enable row level security;

create policy "class_templates_select_same_org"
  on class_templates for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- === class_occurrences ========================================================
-- See compromise #2 above re: the 14 NULL-organization_id rows.

alter table class_occurrences enable row level security;

create policy "class_occurrences_select_same_org"
  on class_occurrences for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- Admin-only, same-org: covers the substitute-approval flow (setting
-- substitute_staff_id) once that route is migrated off the admin client.
create policy "class_occurrences_update_admin"
  on class_occurrences for update
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  )
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

commit;
