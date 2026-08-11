-- Two follow-on bugs surfaced while verifying the cross-org data fix
-- (20260810120000) against The Preserve's real production sync:
--
-- 1. message_boards.organization_id is a denormalized column, independent
--    of department_id. Two of Preserve's group_department boards ("Cycling",
--    "Yoga") had department_id correctly pointing at Preserve's department
--    (departments can no longer be hijacked cross-org since the org-scoped
--    unique constraint landed) but organization_id was still stamped with
--    the sandbox's org id -- a leftover from before that fix, on two
--    departments that weren't flagged as needing manual repoint during the
--    one-time reconciliation. Confirmed via direct join (mb.organization_id
--    <> d.organization_id) that these were the only two affected rows,
--    across every board type. Corrected in place below. Not a recurring
--    risk: since departments are now uniquely scoped per
--    (organization_id, mindbody_program_id), a department's organization_id
--    can no longer change out from under an existing board.
--
-- 2. The "one Announcements board per org" backfill in 20260719232838 was a
--    one-time `insert ... from organizations`, not a trigger -- it only
--    covered orgs that existed at migration time. The Preserve's
--    organizations row didn't exist until the production cutover sync,
--    weeks later, so it never got an Announcements board at all. Fixed with
--    a trigger so any future org (a real multi-tenant future, or another
--    sandbox/production split) gets one automatically, plus a backfill for
--    any org missing one today.
begin;

update message_boards mb
set organization_id = d.organization_id
from departments d
where mb.department_id = d.id
  and mb.organization_id <> d.organization_id;

create or replace function private.create_announcements_board_for_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_boards (organization_id, board_type, title)
  values (new.id, 'announcements', 'Announcements')
  on conflict (organization_id) where board_type = 'announcements' do nothing;

  return new;
end;
$$;

create trigger create_announcements_board_for_org_trigger
  after insert on organizations
  for each row
  execute function private.create_announcements_board_for_org();

insert into message_boards (organization_id, board_type, title)
select id, 'announcements', 'Announcements' from organizations
on conflict (organization_id) where board_type = 'announcements' do nothing;

commit;
