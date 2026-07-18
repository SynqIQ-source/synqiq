-- Fixes a gap found while tracing app/api/substitution-requests/route.ts's
-- supersede flow for the route-migration work: when a previously-approved
-- substitute falls through and a new request is created, that route clears
-- class_occurrences.substitute_staff_id back to null on the same
-- occurrence. The only UPDATE policy on class_occurrences so far
-- (class_occurrences_update_admin, from 20260718210944) is admin-only --
-- but the person triggering a supersede is normally the instructor whose
-- class it is, or the covering instructor who can no longer make it,
-- neither of whom is necessarily an admin (see that route's own comment:
-- "Either the covering instructor ... or a manager ... can trigger this").
--
-- This policy is deliberately narrow: USING allows targeting the row only
-- if the caller is the occurrence's assigned instructor (staff_id) or its
-- currently-assigned substitute (substitute_staff_id); WITH CHECK only
-- accepts a result where substitute_staff_id ends up null. It can only ever
-- be used to clear an assignment, never to set one to an arbitrary staff id
-- -- assigning a substitute stays exclusively the admin-only policy's job
-- (the /select endpoint's approval flow).

begin;

create policy "class_occurrences_update_clear_own_substitute"
  on class_occurrences for update
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and (
      staff_id = private.current_staff_id()
      or substitute_staff_id = private.current_staff_id()
    )
  )
  with check (
    organization_id = private.current_staff_org_id()
    and substitute_staff_id is null
  );

commit;
