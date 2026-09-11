-- Two ways to get a stale staff member off the Staff Logins page, for two
-- different situations:
--
--   1. archived_at -- a real instructor who was let go or went inactive.
--      Soft: the row and all its history (classes, payroll, reviews) stay.
--      Hidden from the working list, shown in a collapsed "Archived"
--      section, restorable. The roster sync still updates the row (name /
--      email changes) but never touches archived_at.
--
--   2. staff_sync_exclusions -- a front-desk person MindBody handed us as
--      an instructor who never should have been in SynqIQ at all. The
--      /api/staff/[id] DELETE route hard-removes the staff row (only when
--      it has no real history -- otherwise it tells the admin to archive
--      instead) and drops a row here so syncStaff never re-creates them.
--      Keyed by (organization_id, mindbody_staff_id) so it survives the
--      staff row's deletion; syncStaff filters the roster against it.
begin;

alter table staff add column archived_at timestamptz;

comment on column staff.archived_at is
  'Set by an admin from the Staff Logins page to hide a former instructor from the working list. Never set or cleared by the MindBody sync. Restorable (null again) from the Archived section.';

create table staff_sync_exclusions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- The MindBody Staff.Id to keep out of the roster. Not an FK to staff --
  -- the whole point is that this outlives the staff row.
  mindbody_staff_id integer not null,
  -- Nulled rather than blocking the delete if that admin is themselves
  -- later removed.
  excluded_by uuid references staff (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_staff_id)
);

alter table staff_sync_exclusions enable row level security;

-- SELECT only -- the DELETE route writes here with the admin client, same
-- interim pattern as the rest of the staff-management routes (staff has a
-- SELECT policy but no write policy; the route's role check is the gate).
create policy "staff_sync_exclusions_select_same_org"
  on staff_sync_exclusions for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

commit;
