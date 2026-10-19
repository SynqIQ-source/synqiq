-- Sub approval tracking + archiving sub-specific message boards.
--
-- 1. substitution_requests.approved_by / approved_staff_id
--    Who approved the sub (an admin) and who ended up covering. Stored on
--    the request itself because the request is SynqIQ-owned data: the
--    nightly Mindbody class sync never writes to this table.
--
--    Before this, the only record of "who covered" was
--    class_occurrences.substitute_staff_id, and lib/sync/classes.ts sent
--    substitute_staff_id: null on every upsert -- so every approved sub was
--    wiped the next night (Instructors showed 0 "picked up", Substitutions
--    showed "Approved -- Unknown"). The sync no longer touches that column
--    (same commit), and this backfills what was lost.
--
-- 2. message_boards update policy for admins, so a sub-specific board can
--    be archived (active = false). Boards are never hard-deleted: Realtime's
--    postgres_changes doesn't apply RLS to DELETE events (see
--    20260719232838_message_boards.sql), and the chat history is kept.

begin;

alter table substitution_requests
  add column approved_by uuid references staff (id),
  add column approved_staff_id uuid references staff (id);

comment on column substitution_requests.approved_by is
  'Admin who approved the substitute. Null for approvals made before this column existed.';
comment on column substitution_requests.approved_staff_id is
  'Instructor who covered the class. Source of truth for "picked up as sub"; the Mindbody sync never writes this table.';

-- Backfill who covered past approvals. On approval, SynqIQ also changes the
-- instructor of record in Mindbody, so for an approved request the class's
-- synced staff_id IS the substitute -- unless it still matches the
-- requester (nothing changed), in which case it's left null rather than
-- guessed.
update substitution_requests sr
set approved_staff_id = coalesce(co.substitute_staff_id, co.staff_id)
from class_occurrences co
where co.id = sr.occurrence_id
  and sr.status = 'approved'
  and sr.approved_staff_id is null
  and coalesce(co.substitute_staff_id, co.staff_id) is not null
  and coalesce(co.substitute_staff_id, co.staff_id) <> sr.requested_by;

-- Restore the substitute on the class itself (what My Schedule's "you're
-- covering" and Follow Up read).
update class_occurrences co
set substitute_staff_id = sr.approved_staff_id
from substitution_requests sr
where sr.occurrence_id = co.id
  and sr.status = 'approved'
  and sr.approved_staff_id is not null
  and co.substitute_staff_id is null;

create policy "message_boards_update_admin"
  on message_boards for update
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
