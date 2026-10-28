-- CRM cross-organization isolation test (acceptance f/g).
--
-- Runs entirely inside one transaction and ROLLS BACK at the end, so it is
-- safe to run against production. Creates a guest (contact, visit, signed
-- waiver, photo object, pending match) in The Preserve, then checks what
-- each kind of caller can see and do through RLS:
--   - a Preserve admin sees all of it
--   - a Preserve instructor without can_sell sees none of it
--   - an admin+seller of ANOTHER org (LastSpot, made temporarily for the
--     test) sees none of it, and LastSpot has no CRM module
--   - anon sees nothing
--   - nobody signed in can insert, update or delete CRM rows directly
--   - signed waivers can't be updated or deleted even by the table owner
-- Any failed check raises an exception (the run errors out).
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/crm_isolation.sql

begin;

-- --- fixtures -------------------------------------------------------------

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  lastspot uuid := '69b91771-be4b-47cf-a0f5-967b80dcff74';
  other_user uuid := gen_random_uuid();
  contact uuid := gen_random_uuid();
  contact2 uuid := gen_random_uuid();
  visit uuid := gen_random_uuid();
  template uuid;
begin
  select id into template from waiver_templates where organization_id = preserve and is_active;

  insert into crm_contacts (id, organization_id, first_name, last_name, email, email_normalized, phone_e164, source)
  values
    (contact, preserve, 'Isolation', 'Test', 'iso@example.com', 'iso@example.com', '+17135550100', 'walk_in'),
    (contact2, preserve, 'Isolation', 'Two', 'iso2@example.com', 'iso2@example.com', '+17135550101', 'walk_in');
  insert into guest_visits (id, organization_id, contact_id, visit_type) values (visit, preserve, contact, 'walk_in');
  insert into waiver_signatures (organization_id, contact_id, visit_id, template_id, template_version, template_sha256,
                                 typed_name, agreed, signature_path, pdf_path, pdf_sha256)
  values (preserve, contact, visit, template, 1, 'x', 'Isolation Test', true,
          preserve || '/waivers/test/signature.png', preserve || '/waivers/test/waiver.pdf', 'x');
  insert into crm_pending_matches (organization_id, submitted_contact_id, candidate_contact_id, reason)
  values (preserve, contact2, contact, 'partial_match');
  insert into storage.objects (bucket_id, name) values ('crm-private', preserve || '/waivers/test/waiver.pdf');

  -- A signed-in admin + seller in LastSpot, for this transaction only.
  insert into auth.users (id, aud, role, email) values (other_user, 'authenticated', 'authenticated', 'crm-iso-test@example.invalid');
  update staff set auth_user_id = other_user, role = 'admin', can_sell = true
  where id = (select id from staff where organization_id = lastspot order by id limit 1);

  perform set_config('crm_test.preserve_admin',
    (select auth_user_id::text from staff where organization_id = preserve and role = 'admin' and auth_user_id is not null limit 1), true);
  perform set_config('crm_test.preserve_instructor',
    (select auth_user_id::text from staff where organization_id = preserve and role = 'instructor' and not can_sell
       and auth_user_id is not null limit 1), true);
  perform set_config('crm_test.other_org_admin', other_user::text, true);
  perform set_config('crm_test.contact', contact::text, true);
  perform set_config('crm_test.signature_path', preserve || '/waivers/test/waiver.pdf', true);
end $$;

-- Counts every CRM table/object visible to the current caller for the
-- fixture rows and checks it against the expected number.
create function pg_temp.expect_visible(expected integer, who text) returns void
language plpgsql as $$
declare
  contact uuid := current_setting('crm_test.contact')::uuid;
  counts jsonb;
begin
  counts := jsonb_build_object(
    'contacts', (select count(*) from crm_contacts where id = contact),
    'visits', (select count(*) from guest_visits where contact_id = contact),
    'signatures', (select count(*) from waiver_signatures where contact_id = contact),
    'pending', (select count(*) from crm_pending_matches where candidate_contact_id = contact),
    'files', (select count(*) from storage.objects where bucket_id = 'crm-private'
                and name = current_setting('crm_test.signature_path'))
  );
  if exists (select 1 from jsonb_each_text(counts) where value::int <> expected) then
    raise exception 'FAIL %: expected % of each, saw %', who, expected, counts;
  end if;
  raise notice 'ok   %: sees % of each %', who, expected, counts;
end $$;

grant execute on function pg_temp.expect_visible(integer, text) to authenticated, anon;

-- --- Preserve admin: sees everything --------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.preserve_admin'), 'role', 'authenticated')::text, true);
select pg_temp.expect_visible(1, 'Preserve admin');
reset role;

-- --- Preserve instructor without can_sell: sees nothing --------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.preserve_instructor'), 'role', 'authenticated')::text, true);
select pg_temp.expect_visible(0, 'Preserve instructor (not a seller)');
reset role;

-- --- Another org's admin + seller: sees nothing ----------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.other_org_admin'), 'role', 'authenticated')::text, true);
select pg_temp.expect_visible(0, 'LastSpot admin+seller');
do $$
begin
  if exists (select 1 from waiver_templates) or exists (select 1 from kiosk_devices)
     or exists (select 1 from crm_marketing_sources) or exists (select 1 from org_modules) then
    raise exception 'FAIL LastSpot admin can see another org''s CRM settings or LastSpot has a CRM module';
  end if;
  raise notice 'ok   LastSpot admin: no CRM templates/sources/devices/modules visible';
end $$;
reset role;

-- --- anon: sees nothing, can't call the rate limiter -----------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.expect_visible(0, 'anon');
do $$
begin
  begin
    perform public.crm_rate_limit_hit('x', 60, 1);
    raise exception 'FAIL anon can call crm_rate_limit_hit';
  exception when insufficient_privilege then
    raise notice 'ok   anon cannot call crm_rate_limit_hit';
  end;
end $$;
reset role;

-- --- Nobody signed in can write CRM rows directly --------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('crm_test.preserve_admin'), 'role', 'authenticated')::text, true);
do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  contact uuid := current_setting('crm_test.contact')::uuid;
  n integer;
begin
  begin
    insert into crm_contacts (organization_id, first_name, last_name, source) values (preserve, 'x', 'y', 'walk_in');
    raise exception 'FAIL admin session inserted a contact directly';
  exception when insufficient_privilege then null;
  end;
  update crm_contacts set first_name = 'Changed' where id = contact;
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL admin session updated a contact directly'; end if;
  delete from waiver_signatures where contact_id = contact;
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL admin session deleted a waiver'; end if;
  -- Supabase blocks direct SQL deletes on storage tables outright; deletes
  -- through the Storage API need a DELETE policy, and crm-private has none
  -- (checked below as the owner).
  begin
    delete from storage.objects where bucket_id = 'crm-private' and name = current_setting('crm_test.signature_path');
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL admin session deleted a waiver file'; end if;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok   admin session cannot insert/update/delete CRM rows or files directly';
end $$;
reset role;

-- --- No policy lets anyone write or delete crm-private files ---------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%crm-private%'
  ) then
    raise exception 'FAIL a storage policy allows writing or deleting crm-private files';
  end if;
  raise notice 'ok   no storage policy allows writing or deleting crm-private files';
end $$;

-- --- Signed waivers are immutable even for the table owner -----------------
do $$
declare
  contact uuid := current_setting('crm_test.contact')::uuid;
begin
  begin
    update waiver_signatures set typed_name = 'Changed' where contact_id = contact;
    raise exception 'FAIL waiver_signatures update allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from waiver_signatures where contact_id = contact;
    raise exception 'FAIL waiver_signatures delete allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from crm_contacts where id = contact;
    raise exception 'FAIL crm_contacts delete allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok   signed waivers and contacts cannot be changed/deleted, even by the owner';
end $$;

rollback;
