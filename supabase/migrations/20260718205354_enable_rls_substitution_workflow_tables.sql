-- Closes a live security gap: substitution_requests, substitution_interests,
-- and instructor_class_eligibility (all created in
-- 20260715180000_substitution_workflow.sql) never had RLS enabled, unlike
-- every other table in this schema. Confirmed empirically against the live
-- database: the public anon key -- which ships in client JS bundles --
-- could read every row of all three tables directly via the PostgREST REST
-- API, completely bypassing the app. This migration only covers these
-- three tables; the rest of the schema (staff, class_occurrences,
-- departments, rooms, organizations, "Locations", class_templates) already
-- has RLS enabled with zero policies (locked, not open) and is deliberately
-- left for a separate, broader RLS pass -- these three are fixed now
-- because they're the ones actually exposed today.
--
-- Every policy below is self-contained to these three tables plus the
-- `private` helper functions -- none of them read staff/class_occurrences/
-- etc. as the calling role, because those tables have RLS enabled with no
-- policies yet (locked to everyone but service-role). A policy here that
-- tried to join directly into e.g. `staff` as the authenticated role would
-- silently evaluate to "no match" always, since staff has no SELECT policy
-- for authenticated yet -- not a bug today (nothing uses an authenticated
-- client yet), but a landmine the moment routes are later migrated off the
-- service-role admin client. The `private.*` functions below are SECURITY
-- DEFINER specifically to sidestep this: they run with the privileges of
-- their owner (not the caller), so they can resolve identity/org lookups on
-- `staff` regardless of staff's own RLS state.

create schema if not exists private;

-- SECURITY DEFINER + a pinned search_path is required here, not optional:
-- without search_path pinned, a caller could in principle shadow `staff`
-- with an object earlier in their own search_path and trick this function
-- into querying the wrong table under elevated privilege. STABLE (not
-- IMMUTABLE) because the result depends on session state (auth.uid()) and
-- table contents, but is constant within a single statement.
create or replace function private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from staff where auth_user_id = auth.uid();
$$;

create or replace function private.current_staff_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from staff where auth_user_id = auth.uid();
$$;

create or replace function private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from staff where auth_user_id = auth.uid();
$$;

-- Resolves ANY staff row's org (not just the caller's) -- needed by the
-- instructor_class_eligibility policies below, since eligibility.staff_id
-- is usually someone other than the admin doing the toggling.
create or replace function private.staff_org_id(target_staff_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from staff where id = target_staff_id;
$$;

revoke all on function private.current_staff_id() from public, anon;
revoke all on function private.current_staff_org_id() from public, anon;
revoke all on function private.current_staff_role() from public, anon;
revoke all on function private.staff_org_id(uuid) from public, anon;
grant execute on function private.current_staff_id() to authenticated;
grant execute on function private.current_staff_org_id() to authenticated;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.staff_org_id(uuid) to authenticated;

-- === substitution_requests ==================================================

alter table substitution_requests enable row level security;

-- Open requests must stay browsable by every instructor in the org (that's
-- how they find classes to volunteer for), not just the requester -- so
-- SELECT is same-org for both roles, not scoped to "own requests only."
create policy "substitution_requests_select_same_org"
  on substitution_requests for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- Closes the gap flagged in app/api/substitution-requests/route.ts's own
-- TODO comment: requested_by was a plain client-supplied field with no
-- verification. This forces it to match the authenticated caller.
create policy "substitution_requests_insert_own"
  on substitution_requests for insert
  to authenticated
  with check (
    requested_by = private.current_staff_id()
    and organization_id = private.current_staff_org_id()
  );

-- Two permissive UPDATE policies (Postgres ORs them together): admins can
-- update any request in their org (approve/resolve/cancel-any); instructors
-- can only update their own (cancel-own).
create policy "substitution_requests_update_admin"
  on substitution_requests for update
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  )
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

create policy "substitution_requests_update_own"
  on substitution_requests for update
  to authenticated
  using (
    requested_by = private.current_staff_id()
    and organization_id = private.current_staff_org_id()
  )
  with check (
    requested_by = private.current_staff_id()
    and organization_id = private.current_staff_org_id()
  );

-- === substitution_interests ==================================================

alter table substitution_interests enable row level security;

-- Scoped via the parent request's org -- this table has no organization_id
-- column of its own. The EXISTS subquery is itself subject to
-- substitution_requests' own SELECT policy above, so it naturally only
-- matches requests the caller could already see -- same-org, both roles.
create policy "substitution_interests_select_same_org"
  on substitution_interests for select
  to authenticated
  using (
    exists (
      select 1 from substitution_requests r
      where r.id = substitution_interests.request_id
        and r.organization_id = private.current_staff_org_id()
    )
  );

-- Closes the same class of gap as substitution_requests_insert_own:
-- staff_id must match the authenticated caller, not a client-supplied value.
create policy "substitution_interests_insert_own"
  on substitution_interests for insert
  to authenticated
  with check (
    staff_id = private.current_staff_id()
    and exists (
      select 1 from substitution_requests r
      where r.id = substitution_interests.request_id
        and r.organization_id = private.current_staff_org_id()
    )
  );

-- Own row only -- e.g. flipping interested -> declined. No admin-wide
-- update policy: nothing in the app updates someone else's interest record.
create policy "substitution_interests_update_own"
  on substitution_interests for update
  to authenticated
  using (staff_id = private.current_staff_id())
  with check (staff_id = private.current_staff_id());

-- === instructor_class_eligibility ============================================

alter table instructor_class_eligibility enable row level security;

create policy "instructor_class_eligibility_select_same_org"
  on instructor_class_eligibility for select
  to authenticated
  using (private.staff_org_id(staff_id) = private.current_staff_org_id());

-- Admin-only writes: only admins can toggle instructor qualifications.
create policy "instructor_class_eligibility_insert_admin"
  on instructor_class_eligibility for insert
  to authenticated
  with check (
    private.current_staff_role() = 'admin'
    and private.staff_org_id(staff_id) = private.current_staff_org_id()
  );

create policy "instructor_class_eligibility_update_admin"
  on instructor_class_eligibility for update
  to authenticated
  using (
    private.current_staff_role() = 'admin'
    and private.staff_org_id(staff_id) = private.current_staff_org_id()
  )
  with check (
    private.current_staff_role() = 'admin'
    and private.staff_org_id(staff_id) = private.current_staff_org_id()
  );
