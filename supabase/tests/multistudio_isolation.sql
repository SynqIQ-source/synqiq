-- Two-studio isolation test: The Preserve and the Demo Studio.
--
-- Runs entirely inside one transaction and ROLLS BACK at the end, so it is
-- safe to run against production. For every table with an organization_id
-- column (classes, clients, sales, staff, the CRM, message boards, sub
-- requests, follow-ups...), signed in through RLS:
--   - a Demo Studio admin + seller sees none of The Preserve's rows
--   - a Preserve admin sees none of the Demo Studio's rows
--   - each still sees their own studio's data (so the test can't pass by
--     seeing nothing at all)
--   - neither can read the other's organizations row (Mindbody activation
--     link, texting number) or platform_admins
-- Any failed check raises an exception (the run errors out).
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/multistudio_isolation.sql

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  demo uuid := (select id from organizations where is_demo limit 1);
  demo_user uuid := gen_random_uuid();
  tables text;
begin
  if demo is null then
    raise exception 'No Demo Studio to test against';
  end if;

  -- A signed-in admin + seller of the Demo Studio, for this transaction only.
  insert into auth.users (id, aud, role, email)
  values (demo_user, 'authenticated', 'authenticated', 'multistudio-test@example.invalid');
  update staff set auth_user_id = demo_user
  where id = (select id from staff where organization_id = demo and role = 'admin' order by id limit 1);

  select string_agg(quote_ident(table_name), ',' order by table_name) into tables
  from information_schema.columns
  where table_schema = 'public' and column_name = 'organization_id'
    and table_name in (select table_name from information_schema.tables
                       where table_schema = 'public' and table_type = 'BASE TABLE');

  perform set_config('iso.preserve', preserve::text, true);
  perform set_config('iso.demo', demo::text, true);
  perform set_config('iso.tables', tables, true);
  perform set_config('iso.demo_user', demo_user::text, true);
  perform set_config('iso.preserve_admin',
    (select auth_user_id::text from staff where organization_id = preserve and role = 'admin'
       and can_sell and auth_user_id is not null order by id limit 1), true);
end $$;

-- Rows of `org` the current caller can see, per table (only non-zero).
create function pg_temp.visible(org uuid) returns jsonb
language plpgsql as $$
declare
  t text;
  n bigint;
  seen jsonb := '{}';
begin
  foreach t in array string_to_array(current_setting('iso.tables'), ',') loop
    begin
      execute format('select count(*) from public.%s where organization_id = $1', t) into n using org;
    exception when insufficient_privilege then
      n := 0;
    end;
    if n > 0 then
      seen := seen || jsonb_build_object(t, n);
    end if;
  end loop;
  return seen;
end $$;
grant execute on function pg_temp.visible(uuid) to authenticated;

create function pg_temp.expect(who text, other_org uuid, own_org uuid) returns void
language plpgsql as $$
declare
  leaked jsonb := pg_temp.visible(other_org);
  own jsonb := pg_temp.visible(own_org);
begin
  if leaked <> '{}' then
    raise exception 'FAIL %: can see the other studio''s rows: %', who, leaked;
  end if;
  if not (own ? 'crm_contacts') or not (own ? 'class_occurrences') then
    raise exception 'FAIL %: can''t see its own studio''s contacts and classes (%), so the test proves nothing', who, own;
  end if;
  if exists (select 1 from organizations where id = other_org) then
    raise exception 'FAIL %: can read the other studio''s organizations row', who;
  end if;
  begin
    perform 1 from platform_admins limit 1;
    if found then
      raise exception 'FAIL %: can read platform_admins', who;
    end if;
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'ok   %: sees 0 rows of the other studio across % tables; own studio visible in % tables',
    who, array_length(string_to_array(current_setting('iso.tables'), ','), 1), (select count(*) from jsonb_object_keys(own));
end $$;
grant execute on function pg_temp.expect(text, uuid, uuid) to authenticated;

-- --- Demo Studio admin + seller: none of The Preserve -------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('iso.demo_user'), 'role', 'authenticated')::text, true);
select pg_temp.expect('Demo Studio admin', current_setting('iso.preserve')::uuid, current_setting('iso.demo')::uuid);
reset role;

-- --- Preserve admin + seller: none of the Demo Studio -------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('iso.preserve_admin'), 'role', 'authenticated')::text, true);
select pg_temp.expect('Preserve admin', current_setting('iso.demo')::uuid, current_setting('iso.preserve')::uuid);
reset role;

rollback;
