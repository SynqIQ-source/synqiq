-- Commission: Club Admins see plans, product categories and everyone's
-- commission lines; other staff see only their own lines and none of the
-- settings; nobody writes directly (all writes go through the API).
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
  plan uuid;
begin
  if sales_staff is null or admin_staff is null then
    raise exception 'Need a Sales and a Club Admin staff member at The Preserve';
  end if;
  insert into auth.users (id, aud, role, email) values
    (sales_user, 'authenticated', 'authenticated', 'comm-sales-test@example.invalid'),
    (admin_user, 'authenticated', 'authenticated', 'comm-admin-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  update staff set auth_user_id = admin_user where id = admin_staff;
  insert into commission_plans (organization_id, name) values (preserve, 'zz test plan') returning id into plan;
  insert into commission_rules (organization_id, plan_id, category, condition, percent) values (preserve, plan, 'retail', 'any', 5);
  insert into commission_lines (organization_id, staff_id, kind, mindbody_sale_id, mindbody_sale_detail_id, sale_at, earned_at,
      description, category, condition, base_cents, amount_cents)
    values
      (preserve, sales_staff, 'earn', -1, -1, now(), now(), 'zz test', 'retail', 'any', 1000, 50),
      (preserve, admin_staff, 'earn', -2, -2, now(), now(), 'zz test', 'retail', 'any', 1000, 50);
  perform set_config('comm.sales_user', sales_user::text, true);
  perform set_config('comm.admin_user', admin_user::text, true);
  perform set_config('comm.sales_staff', sales_staff::text, true);
  perform set_config('comm.preserve', preserve::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('comm.sales_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from commission_lines where staff_id = current_setting('comm.sales_staff')::uuid) then
    raise exception 'Sales cannot see their own commission';
  end if;
  if exists (select 1 from commission_lines where staff_id <> current_setting('comm.sales_staff')::uuid) then
    raise exception 'Sales can see someone else''s commission';
  end if;
  if exists (select 1 from commission_plans) or exists (select 1 from commission_rules) then
    raise exception 'Sales can see commission plans';
  end if;
  begin
    insert into commission_lines (organization_id, staff_id, kind, mindbody_sale_id, mindbody_sale_detail_id, sale_at, earned_at,
        description, category, condition, base_cents, amount_cents)
      values (current_setting('comm.preserve')::uuid, current_setting('comm.sales_staff')::uuid, 'earn', -3, -3, now(), now(),
        'zz', 'retail', 'any', 1, 99999);
    raise exception 'Sales could write their own commission';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('comm.admin_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from commission_lines where description = 'zz test') < 2 then
    raise exception 'Club Admin cannot see everyone''s commission';
  end if;
  if not exists (select 1 from commission_plans where name = 'zz test plan') then
    raise exception 'Club Admin cannot see plans';
  end if;
  begin
    insert into commission_plans (organization_id, name) values (current_setting('comm.preserve')::uuid, 'zz direct');
    raise exception 'Club Admin could write a plan directly';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
