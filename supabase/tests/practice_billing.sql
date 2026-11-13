-- Billing test: only Club Admins see test members and practice charges;
-- nobody writes directly. Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  sales_user uuid := gen_random_uuid();
  sales_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' order by id limit 1);
  schedule uuid;
begin
  insert into auth.users (id, aud, role, email) values (sales_user, 'authenticated', 'authenticated', 'billing-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  insert into billing_test_members (organization_id, mindbody_client_id) values (preserve, 'zz-test') on conflict do nothing;
  insert into member_billing_schedules (organization_id, source, mindbody_client_contract_id, mindbody_client_id, name, start_date, first_bill_date, recurring_subtotal_cents, recurring_total_cents)
    values (preserve, 'mindbody', -1, 'zz-test', 'zz schedule', current_date, current_date, 100, 100) returning id into schedule;
  insert into practice_charges (organization_id, schedule_id, mindbody_client_id, due_date, subtotal_cents, tax_cents, total_cents)
    values (preserve, schedule, 'zz-test', current_date, 100, 0, 100);
  perform set_config('pb.user', sales_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pb.user'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from billing_test_members) then
    raise exception 'Sales can see billing test members';
  end if;
  if exists (select 1 from practice_charges) then
    raise exception 'Sales can see practice charges';
  end if;
  if exists (select 1 from member_billing_schedules where name = 'zz schedule') then
    raise exception 'Sales can see an imported Mindbody schedule';
  end if;
end $$;

rollback;
