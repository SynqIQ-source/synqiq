-- New member IDs (allocate_member_id): continue the studio's sequence above
-- the highest existing number, never hand out a number a client already has,
-- and never the same number twice. Staff (authenticated) can't call it.
-- Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  top bigint := (select max(mindbody_unique_id) from clients where organization_id = preserve and mindbody_unique_id < 1000000000);
  first_id bigint;
  second_id bigint;
  third_id bigint;
begin
  first_id := public.allocate_member_id(preserve);
  if first_id <= top then
    raise exception 'Member ID % is not above the highest existing number %', first_id, top;
  end if;
  second_id := public.allocate_member_id(preserve);
  if second_id <> first_id + 1 then
    raise exception 'Member IDs are not in sequence: % then %', first_id, second_id;
  end if;
  -- A client who already has the next number (e.g. created in Mindbody) is skipped.
  insert into clients (organization_id, mindbody_unique_id, mindbody_client_id, first_name, last_name, status, is_prospect)
    values (preserve, second_id + 1, (second_id + 1)::text, 'zz', 'Taken', 'Active', false);
  third_id := public.allocate_member_id(preserve);
  if third_id <> second_id + 2 then
    raise exception 'A number already in use was handed out: %', third_id;
  end if;
end $$;

set local role authenticated;
do $$
begin
  perform public.allocate_member_id((select id from organizations where mindbody_site_id = 561843));
  raise exception 'Staff were able to allocate a member ID directly';
exception when insufficient_privilege then
  null;
end $$;

rollback;
