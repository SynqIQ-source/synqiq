-- Gives the instructor currently covering a class (class_occurrences.
-- substitute_staff_id) a way to supersede their own approved coverage --
-- e.g. they can no longer make it and a fresh request needs to open up --
-- without granting them any standalone UPDATE access on substitution_requests.
--
-- An earlier design considered a third UPDATE policy (mirroring
-- class_occurrences_update_clear_own_substitute's USING/WITH CHECK shape)
-- but rejected it: RLS policies gate individual statements, not sequences
-- of statements, so a raw UPDATE grant would let the covering instructor
-- cancel their approved row via a direct REST PATCH with no guarantee a
-- replacement request is ever created -- orphaning the class with no
-- substitute and no open request. There's also no way for a WITH CHECK
-- clause to pin occurrence_id/requested_by/reason to their prior values
-- (Postgres RLS can't correlate OLD and NEW columns in one expression), so
-- a raw grant could also let other fields ride along on the same PATCH.
--
-- This function closes both gaps by making the cancel-old +
-- clear-occurrence-substitute + insert-new sequence a single atomic,
-- narrowly-scoped operation instead of a bare grant:
--   - SECURITY DEFINER so it can perform the writes itself -- the covering
--     instructor gets ZERO direct UPDATE access to substitution_requests;
--     the only UPDATE policies on that table remain
--     substitution_requests_update_admin and _update_own, unchanged.
--   - Internally verifies the caller is recorded RIGHT NOW as the linked
--     occurrence's substitute_staff_id before touching anything.
--   - Always does all three writes together in one transaction -- there is
--     no code path where a cancel happens without the replacement being
--     created, unlike a raw UPDATE grant would allow.
--   - Column values written are fully controlled by the function body, not
--     client-supplied, so there's no smuggling extra field changes in.
--
-- Lives in the `public` schema (not `private`, unlike the helper functions
-- in 20260718205354) because PostgREST only exposes public-schema functions
-- for supabase-js's .rpc() -- the private schema is deliberately excluded
-- from that exposure.

begin;

create or replace function public.supersede_substitution_request(
  p_occurrence_id uuid,
  p_reason text default null
)
returns table (superseded_request_id uuid, new_request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_staff_id uuid := private.current_staff_id();
  v_caller_org_id uuid := private.current_staff_org_id();
  v_occurrence record;
  v_existing record;
  v_new_id uuid;
begin
  if v_caller_staff_id is null then
    raise exception 'Not an authenticated staff member.';
  end if;

  select id, organization_id, substitute_staff_id
    into v_occurrence
    from class_occurrences
    where id = p_occurrence_id
      and organization_id = v_caller_org_id;

  if not found then
    raise exception 'Class occurrence not found.';
  end if;

  -- Only the instructor CURRENTLY assigned as the covering substitute may
  -- call this. The original requester's own cancel-and-reopen path is
  -- unchanged -- it still goes through substitution_requests_update_own +
  -- substitution_requests_insert_own directly, not this function.
  if v_occurrence.substitute_staff_id is distinct from v_caller_staff_id then
    raise exception 'Only the instructor currently assigned to cover this class can supersede it.';
  end if;

  select id, status
    into v_existing
    from substitution_requests
    where occurrence_id = p_occurrence_id
      and status = 'approved'
    for update;

  if not found then
    raise exception 'No approved substitution request exists for this occurrence.';
  end if;

  update substitution_requests
    set status = 'cancelled', resolved_at = now()
    where id = v_existing.id;

  update class_occurrences
    set substitute_staff_id = null
    where id = p_occurrence_id;

  insert into substitution_requests (occurrence_id, organization_id, requested_by, status, reason)
    values (p_occurrence_id, v_occurrence.organization_id, v_caller_staff_id, 'open', p_reason)
    returning id into v_new_id;

  return query select v_existing.id, v_new_id;
end;
$$;

revoke all on function public.supersede_substitution_request(uuid, text) from public, anon;
grant execute on function public.supersede_substitution_request(uuid, text) to authenticated;

commit;
