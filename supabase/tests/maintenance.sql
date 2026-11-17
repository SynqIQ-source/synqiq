-- Maintenance: staff of the studio can read its issues, equipment and
-- vendors; nobody writes directly (the API does, after its role checks);
-- another studio's records are invisible. Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  other_org uuid := (select id from organizations where id <> (select id from organizations where mindbody_site_id = 561843) order by created_at limit 1);
  staff_user uuid := gen_random_uuid();
  some_staff uuid := (select id from staff where organization_id = preserve and role = 'staff' order by id limit 1);
  item uuid;
begin
  insert into auth.users (id, aud, role, email) values (staff_user, 'authenticated', 'authenticated', 'maintenance-test@example.invalid');
  update staff set auth_user_id = staff_user where id = some_staff;
  insert into maintenance_equipment (organization_id, name, is_critical) values (preserve, 'zzSteam', true) returning id into item;
  insert into maintenance_issues (organization_id, equipment_id, title, description, is_critical)
    values (preserve, item, 'zzNoSteam', 'test', true);
  insert into maintenance_vendors (organization_id, name, email) values (preserve, 'zzVendor', 'v@example.invalid');
  if other_org is not null then
    insert into maintenance_issues (organization_id, location_text, title, description) values (other_org, 'x', 'zzOtherStudio', 'test');
  end if;
  begin
    insert into maintenance_issues (organization_id, location_text, title, description, status) values (preserve, 'x', 'zzBad', 'test', 'bogus');
    raise exception 'An unknown status was accepted';
  exception when check_violation then
    null;
  end;
  perform set_config('mt.user', staff_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('mt.user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from maintenance_issues where title = 'zzNoSteam') then
    raise exception 'Staff cannot see their studio''s maintenance issues';
  end if;
  if not exists (select 1 from maintenance_equipment where name = 'zzSteam') or not exists (select 1 from maintenance_vendors where name = 'zzVendor') then
    raise exception 'Staff cannot see equipment or vendors';
  end if;
  if exists (select 1 from maintenance_issues where title = 'zzOtherStudio') then
    raise exception 'Staff can see another studio''s maintenance issues';
  end if;
  begin
    insert into maintenance_events (organization_id, issue_id, kind, body)
      select organization_id, id, 'note', 'direct' from maintenance_issues where title = 'zzNoSteam';
    raise exception 'Staff could write a maintenance event directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update maintenance_issues set status = 'resolved' where title = 'zzNoSteam';
    if exists (select 1 from maintenance_issues where title = 'zzNoSteam' and status = 'resolved') then
      raise exception 'Staff could resolve an issue directly';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
