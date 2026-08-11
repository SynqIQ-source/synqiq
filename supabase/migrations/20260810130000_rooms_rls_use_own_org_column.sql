-- rooms.organization_id now exists and is NOT NULL for every row (see
-- 20260810120000 + the one-time reconciliation that populated it). The
-- existing rooms_select_same_org policy predates that column and scopes
-- indirectly via a "Locations" join on location_id -- which silently
-- returns nothing for any room with a null location_id (e.g. a room never
-- yet seen in a class occurrence, like a real "Wellness Room" before its
-- first backfill, or the sandbox-only leftover rooms with no location at
-- all). Scoping on rooms.organization_id directly is both simpler and
-- correct for those cases too.
begin;

drop policy "rooms_select_same_org" on rooms;

create policy "rooms_select_same_org"
  on rooms for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

commit;
