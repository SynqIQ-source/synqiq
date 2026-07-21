-- ============================================================================
-- Backfills location_id on rooms (derived empirically from a full historical
-- MindBody class scan -- see conversation history) and adds a direct
-- organization_id column to departments (mirroring class_templates), then
-- tightens both tables' SELECT policies from the "any authenticated staff"
-- compromise (20260718210944) to real org-scoping.
--
-- Why departments gets organization_id instead of extending the location_id
-- model: cross-referencing GET /class/classes[].Resource + .Location +
-- .ClassDescription.Program against 1,254 classes across the full 90-day/
-- all-locations sync window (both real locations: Clubville id=1, Fitville
-- id=2) showed rooms are cleanly 1:1 with a location (every one of the 5
-- resources with any class history mapped to exactly one location, zero
-- exceptions -- matches physical reality, a room is a space in one
-- building) but departments are NOT (2 of the 5 programs with class
-- history -- Boot Camp id=10, Classes id=26 -- were taught at BOTH
-- locations). A department is an org-wide category, not a physical room;
-- forcing a single location_id onto it would misrepresent roughly 40% of
-- the departments that have any data at all. class_templates already
-- establishes the org-scoped-not-location-scoped pattern for exactly this
-- kind of row, so departments follows it directly instead.
--
-- Neither /site/resources nor /class/classdescriptions -- the endpoints
-- syncRooms/syncDepartments already call -- return a location relationship
-- at all (confirmed against the raw API response, not just this codebase's
-- existing types). The only place a room or program co-occurs with a
-- location is per class occurrence, and class_occurrences itself has never
-- stored that -- there's no column for it -- so this room backfill can't be
-- derived from anything already in Postgres; it encodes what the live
-- MindBody API returned at investigation time.
--
-- rooms.location_id already existed (nullable uuid, FK to "Locations") --
-- this migration only backfills data and tightens the policy, no column
-- change. departments.location_id also stays in place, unused -- dropping
-- it is a separate, more destructive call not made here.
-- ============================================================================

begin;

-- === rooms: backfill location_id from the empirical resource -> location map ===
-- Only the 5 resources that appeared in any class in the 90-day/all-locations
-- window are backfilled (all 5 resolved to Clubville, mindbody_location_id
-- 1); the other 3 (mindbody_resource_id 2, 19, 20 -- zero classes scheduled
-- against them in that window) are left NULL rather than guessed at.
-- rooms_select_same_org below treats a NULL location_id as invisible, same
-- tradeoff already accepted elsewhere in this schema for similar coverage
-- gaps (e.g. class_occurrences' NULL-organization_id rows).
update rooms
set location_id = (select id from "Locations" where mindbody_location_id = 1)
where mindbody_resource_id in (1, 3, 5, 12, 23);

-- === departments: add organization_id, mirroring class_templates ===============
alter table departments
  add column organization_id uuid references organizations (id);

-- Single-org sandbox: no LIMIT 1 here on purpose -- if this ever runs
-- against a DB with more than one organizations row, the subquery errors
-- loudly instead of silently assigning every department to an arbitrary org.
update departments
set organization_id = (select id from organizations);

alter table departments
  alter column organization_id set not null;

-- === rooms: tighten SELECT policy to real org-scoping via location_id =========
drop policy "rooms_select_any_authenticated_staff" on rooms;

create policy "rooms_select_same_org"
  on rooms for select
  to authenticated
  using (
    exists (
      select 1 from "Locations" l
      where l.id = rooms.location_id
        and l.organization_id = private.current_staff_org_id()
    )
  );

-- === departments: tighten SELECT policy to real org-scoping ===================
drop policy "departments_select_any_authenticated_staff" on departments;

create policy "departments_select_same_org"
  on departments for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

commit;
