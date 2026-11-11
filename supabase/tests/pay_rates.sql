-- Pay settings: Club Admins see all pay rates and everyone's pay; other staff
-- see only their own pay settings and none of the rate templates; nobody
-- writes directly (all writes go through the API).
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
  rate uuid;
begin
  if sales_staff is null or admin_staff is null then
    raise exception 'Need a Sales and a Club Admin staff member at The Preserve';
  end if;
  insert into auth.users (id, aud, role, email) values
    (sales_user, 'authenticated', 'authenticated', 'pay-sales-test@example.invalid'),
    (admin_user, 'authenticated', 'authenticated', 'pay-admin-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  update staff set auth_user_id = admin_user where id = admin_staff;
  insert into pay_rates (organization_id, name, applies_to, method, base_cents, per_head_cents, heads_above, cap_cents)
    values (preserve, 'zz test rate', 'class', 'class_formula', 4000, 500, 6, 7500)
    returning id into rate;
  insert into staff_pay_settings (staff_id, organization_id, hourly_rate_cents, class_rate_id)
    values (sales_staff, preserve, 1500, rate), (admin_staff, preserve, 4300, rate)
    on conflict (staff_id) do update set hourly_rate_cents = excluded.hourly_rate_cents;
  perform set_config('pay.sales_user', sales_user::text, true);
  perform set_config('pay.admin_user', admin_user::text, true);
  perform set_config('pay.sales_staff', sales_staff::text, true);
  perform set_config('pay.preserve', preserve::text, true);
end $$;

-- --- Sales: own pay only, no rate templates --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pay.sales_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from staff_pay_settings where staff_id = current_setting('pay.sales_staff')::uuid) then
    raise exception 'Sales cannot see their own pay settings';
  end if;
  if exists (select 1 from staff_pay_settings where staff_id <> current_setting('pay.sales_staff')::uuid) then
    raise exception 'Sales can see someone else''s pay';
  end if;
  if exists (select 1 from pay_rates) then
    raise exception 'Sales can see the pay rate templates';
  end if;
  begin
    update staff_pay_settings set hourly_rate_cents = 99999 where staff_id = current_setting('pay.sales_staff')::uuid;
    if found then
      raise exception 'Sales could change their own pay';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- --- Club Admin: everything, read-only -------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pay.admin_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from staff_pay_settings) < 2 then
    raise exception 'Club Admin cannot see everyone''s pay';
  end if;
  if not exists (select 1 from pay_rates where name = 'zz test rate') then
    raise exception 'Club Admin cannot see pay rates';
  end if;
  begin
    insert into pay_rates (organization_id, name, applies_to, method, flat_cents)
      values (current_setting('pay.preserve')::uuid, 'zz direct', 'class', 'flat', 100);
    raise exception 'Club Admin could write a pay rate directly (should go through the API)';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
