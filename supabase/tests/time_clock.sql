-- Time clock: staff see only their own shifts and can't write them directly;
-- Club Admins see everyone's shifts and the change log.
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  sales_user uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  sales_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' order by id limit 1);
  admin_staff uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
  admin_punch uuid;
begin
  if sales_staff is null or admin_staff is null then
    raise exception 'Need a Sales and a Club Admin staff member at The Preserve';
  end if;
  insert into auth.users (id, aud, role, email) values
    (sales_user, 'authenticated', 'authenticated', 'clock-sales-test@example.invalid'),
    (admin_user, 'authenticated', 'authenticated', 'clock-admin-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  update staff set auth_user_id = admin_user where id = admin_staff;
  insert into time_punches (organization_id, staff_id, clock_in_at, clock_out_at)
    values (preserve, sales_staff, now() - interval '30 days 5 hours', now() - interval '30 days 1 hour');
  insert into time_punches (organization_id, staff_id, clock_in_at, clock_out_at)
    values (preserve, admin_staff, now() - interval '30 days 5 hours', now() - interval '30 days 1 hour')
    returning id into admin_punch;
  insert into time_punch_edits (organization_id, punch_id, edited_by_staff_id, action, reason)
    values (preserve, admin_punch, admin_staff, 'edit', 'test');
  perform set_config('clock.sales_user', sales_user::text, true);
  perform set_config('clock.admin_user', admin_user::text, true);
  perform set_config('clock.sales_staff', sales_staff::text, true);
  perform set_config('clock.admin_staff', admin_staff::text, true);
  perform set_config('clock.preserve', preserve::text, true);
end $$;

-- --- Sales: only their own shifts -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('clock.sales_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from time_punches where staff_id = current_setting('clock.sales_staff')::uuid) then
    raise exception 'Sales cannot see their own shift';
  end if;
  if exists (select 1 from time_punches where staff_id <> current_setting('clock.sales_staff')::uuid) then
    raise exception 'Sales can see someone else''s shifts';
  end if;
  if exists (select 1 from time_punch_edits) then
    raise exception 'Sales can see the timesheet change log';
  end if;
  begin
    insert into time_punches (organization_id, staff_id, clock_in_at)
      values (current_setting('clock.preserve')::uuid, current_setting('clock.sales_staff')::uuid, now());
    raise exception 'Sales could write a shift directly (should go through the API)';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- --- Club Admin: everyone's shifts and the log ------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('clock.admin_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from time_punches where staff_id = current_setting('clock.sales_staff')::uuid) then
    raise exception 'Club Admin cannot see staff shifts';
  end if;
  if not exists (select 1 from time_punch_edits) then
    raise exception 'Club Admin cannot see the change log';
  end if;
end $$;

rollback;
