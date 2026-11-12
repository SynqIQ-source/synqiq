-- Checkout sales: Club Admins see every sale; other staff see only the sales
-- they rang up; promo codes are Club Admin only; nobody writes directly.
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  sales_user uuid := gen_random_uuid();
  sales_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' order by id limit 1);
  admin_staff uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
  mine uuid;
  theirs uuid;
begin
  insert into auth.users (id, aud, role, email) values (sales_user, 'authenticated', 'authenticated', 'pos-sales-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  insert into pos_sales (organization_id, staff_id, subtotal_cents, total_cents, tax_rate)
    values (preserve, sales_staff, 100, 100, 0.0825) returning id into mine;
  insert into pos_sales (organization_id, staff_id, subtotal_cents, total_cents, tax_rate)
    values (preserve, admin_staff, 200, 200, 0.0825) returning id into theirs;
  insert into pos_sale_lines (organization_id, sale_id, name, kind, quantity, unit_price_cents, taxable, total_cents, line_number)
    values (preserve, mine, 'zz', 'product', 1, 100, false, 100, 1), (preserve, theirs, 'zz', 'product', 1, 200, false, 200, 1);
  insert into promo_codes (organization_id, code, kind, percent) values (preserve, 'ZZTEST', 'percent', 10);
  insert into member_billing_schedules (organization_id, sale_id, mindbody_client_id, name, start_date, first_bill_date, recurring_subtotal_cents, recurring_total_cents)
    values (preserve, mine, 'zz1', 'zz mine', current_date, current_date + 30, 100, 100),
           (preserve, theirs, 'zz2', 'zz theirs', current_date, current_date + 30, 200, 200);
  perform set_config('pos.sales_user', sales_user::text, true);
  perform set_config('pos.mine', mine::text, true);
  perform set_config('pos.preserve', preserve::text, true);
  perform set_config('pos.sales_staff', sales_staff::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pos.sales_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from pos_sales where id = current_setting('pos.mine')::uuid) then
    raise exception 'Sales cannot see their own sale';
  end if;
  if exists (select 1 from pos_sales where id <> current_setting('pos.mine')::uuid and total_cents = 200) then
    raise exception 'Sales can see someone else''s sale';
  end if;
  if exists (select 1 from pos_sale_lines where sale_id <> current_setting('pos.mine')::uuid and total_cents = 200) then
    raise exception 'Sales can see someone else''s sale lines';
  end if;
  if not exists (select 1 from member_billing_schedules where name = 'zz mine') then
    raise exception 'Sales cannot see the payment schedule from their own sale';
  end if;
  if exists (select 1 from member_billing_schedules where name = 'zz theirs') then
    raise exception 'Sales can see the payment schedule from someone else''s sale';
  end if;
  if exists (select 1 from promo_codes) then
    raise exception 'Sales can see promo codes';
  end if;
  begin
    insert into pos_sales (organization_id, staff_id, subtotal_cents, total_cents, tax_rate)
      values (current_setting('pos.preserve')::uuid, current_setting('pos.sales_staff')::uuid, 1, 1, 0);
    raise exception 'Sales could write a sale directly (should go through the API)';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
