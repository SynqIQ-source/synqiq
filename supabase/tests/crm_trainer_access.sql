-- Trainer access test for new-member onboarding.
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Creates two enrolled members in The Preserve -- one assigned
-- to trainer A, one unassigned -- each with a message, note, visit and photo,
-- then checks through RLS that:
--   - trainer A (an instructor without can_sell) sees all of their member's
--     profile data and none of the other member's
--   - trainer B (another instructor) sees none of either
--   - a trainer can't write CRM rows directly
-- Any failed check raises an exception.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/crm_trainer_access.sql

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  trainer_a uuid;
  trainer_b uuid;
  mine uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
begin
  select id into trainer_a from staff
  where organization_id = preserve and role = 'instructor' and not can_sell
    and auth_user_id is not null and archived_at is null
  order by id limit 1;
  select id into trainer_b from staff
  where organization_id = preserve and role = 'instructor' and not can_sell
    and auth_user_id is not null and archived_at is null and id <> trainer_a
  order by id limit 1;

  insert into crm_contacts (id, organization_id, first_name, last_name, source, status, member_enrolled_at,
                            trainer_staff_id, trainer_assigned_at, photo_path)
  values
    (mine, preserve, 'Trainer', 'Mine', 'member', 'member', now(), trainer_a, now(), preserve || '/photos/trainer-test-mine.jpg'),
    (other, preserve, 'Trainer', 'Other', 'member', 'member', now(), null, null, preserve || '/photos/trainer-test-other.jpg');
  insert into crm_messages (organization_id, contact_id, channel, direction, body, status)
  values (preserve, mine, 'call', 'outbound', 'test', 'sent'), (preserve, other, 'call', 'outbound', 'test', 'sent');
  insert into crm_notes (organization_id, contact_id, author_staff_id, body)
  values (preserve, mine, trainer_a, 'test'), (preserve, other, trainer_a, 'test');
  insert into guest_visits (organization_id, contact_id, visit_type)
  values (preserve, mine, 'walk_in'), (preserve, other, 'walk_in');
  insert into storage.objects (bucket_id, name)
  values ('crm-private', preserve || '/photos/trainer-test-mine.jpg'), ('crm-private', preserve || '/photos/trainer-test-other.jpg');

  perform set_config('crm_test.trainer_a', (select auth_user_id::text from staff where id = trainer_a), true);
  perform set_config('crm_test.trainer_b', (select auth_user_id::text from staff where id = trainer_b), true);
  perform set_config('crm_test.mine', mine::text, true);
  perform set_config('crm_test.other', other::text, true);
end $$;

-- Rows of each kind the caller can see for one member.
create function pg_temp.expect_member(setting text, expected integer, who text) returns void
language plpgsql as $$
declare
  member uuid := current_setting(setting)::uuid;
  counts jsonb;
begin
  counts := jsonb_build_object(
    'contacts', (select count(*) from crm_contacts where id = member),
    'messages', (select count(*) from crm_messages where contact_id = member),
    'notes', (select count(*) from crm_notes where contact_id = member),
    'visits', (select count(*) from guest_visits where contact_id = member),
    'photos', (select count(*) from storage.objects o where o.bucket_id = 'crm-private'
                 and o.name = (select c.photo_path from crm_contacts c where c.id = member))
  );
  if exists (select 1 from jsonb_each_text(counts) where value::int <> expected) then
    raise exception 'FAIL %: expected % of each, saw %', who, expected, counts;
  end if;
  raise notice 'ok   %: sees % of each %', who, expected, counts;
end $$;
grant execute on function pg_temp.expect_member(text, integer, text) to authenticated;

-- --- Trainer A: their member yes, the other member no ----------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.trainer_a'), 'role', 'authenticated')::text, true);
select pg_temp.expect_member('crm_test.mine', 1, 'trainer A, assigned member');
select pg_temp.expect_member('crm_test.other', 0, 'trainer A, unassigned member');
do $$
begin
  begin
    insert into crm_messages (organization_id, contact_id, channel, direction, body, status)
    values ((select organization_id from crm_contacts where id = current_setting('crm_test.mine')::uuid),
            current_setting('crm_test.mine')::uuid, 'call', 'outbound', 'x', 'sent');
    raise exception 'FAIL trainer inserted a message directly';
  exception when insufficient_privilege then
    raise notice 'ok   trainer A cannot write messages directly';
  end;
  update crm_contacts set first_name = 'Changed' where id = current_setting('crm_test.mine')::uuid;
  if found then
    raise exception 'FAIL trainer updated a contact directly';
  end if;
  raise notice 'ok   trainer A cannot update contacts directly';
exception when insufficient_privilege then
  raise notice 'ok   trainer A cannot update contacts directly';
end $$;
reset role;

-- --- Trainer B: neither ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.trainer_b'), 'role', 'authenticated')::text, true);
select pg_temp.expect_member('crm_test.mine', 0, 'trainer B, trainer A''s member');
select pg_temp.expect_member('crm_test.other', 0, 'trainer B, unassigned member');
reset role;

rollback;
