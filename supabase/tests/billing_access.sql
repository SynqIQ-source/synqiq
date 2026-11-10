-- Billing data and price increases are Club Admin only (The Preserve).
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Signed in through RLS:
--   - a Sales staff member sees no member contracts, plans, Mindbody
--     AutoPay rows or billing edits, and can't add a billing edit
--   - a Club Admin can see contracts and add + cancel a billing edit
-- Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  sales_user uuid := gen_random_uuid();
  admin_user uuid := gen_random_uuid();
  sales_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' order by id limit 1);
  admin_staff uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
begin
  if sales_staff is null or admin_staff is null then
    raise exception 'Need a Sales and a Club Admin staff member at The Preserve';
  end if;
  insert into auth.users (id, aud, role, email) values
    (sales_user, 'authenticated', 'authenticated', 'billing-sales-test@example.invalid'),
    (admin_user, 'authenticated', 'authenticated', 'billing-admin-test@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  update staff set auth_user_id = admin_user where id = admin_staff;
  perform set_config('bill.preserve', preserve::text, true);
  perform set_config('bill.sales_user', sales_user::text, true);
  perform set_config('bill.admin_user', admin_user::text, true);
  perform set_config('bill.admin_staff', admin_staff::text, true);
  perform set_config('bill.client', (select mindbody_client_id from member_contracts where organization_id = preserve limit 1), true);
end $$;

-- --- Sales: nothing ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('bill.sales_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from member_contracts) or exists (select 1 from membership_plans)
     or exists (select 1 from mbo_autopay_rows) or exists (select 1 from billing_adjustments)
     or exists (select 1 from price_increases) or exists (select 1 from price_increase_items) then
    raise exception 'FAIL Sales can see billing data';
  end if;
  begin
    insert into billing_adjustments (organization_id, mindbody_client_id, kind, amount_cents, starts_on, reason, created_by_staff_id)
    values (current_setting('bill.preserve')::uuid, 'x', 'credit', 100, current_date, 'test', current_setting('bill.admin_staff')::uuid);
    raise exception 'FAIL Sales added a billing edit';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into price_increases (organization_id, name, percent, effective_on, created_by_staff_id)
    values (current_setting('bill.preserve')::uuid, 'test', 5, '2027-02-01', current_setting('bill.admin_staff')::uuid);
    raise exception 'FAIL Sales scheduled a price increase';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'ok   Sales: no billing data, can''t add edits or price increases';
end $$;
reset role;

-- --- Club Admin: sees and edits ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('bill.admin_user'), 'role', 'authenticated')::text, true);
do $$
declare
  edit uuid;
begin
  if not exists (select 1 from member_contracts) then
    raise exception 'FAIL Club Admin can''t see member contracts';
  end if;
  insert into billing_adjustments (organization_id, mindbody_client_id, kind, amount_cents, starts_on, reason, created_by_staff_id)
  values (current_setting('bill.preserve')::uuid, current_setting('bill.client'), 'credit', 100, current_date, 'test', current_setting('bill.admin_staff')::uuid)
  returning id into edit;
  update billing_adjustments set cancelled_at = now(), cancelled_by_staff_id = current_setting('bill.admin_staff')::uuid, cancel_reason = 'test'
  where id = edit;
  if not found then
    raise exception 'FAIL Club Admin couldn''t cancel a billing edit';
  end if;
  insert into price_increases (organization_id, name, percent, effective_on, created_by_staff_id)
  values (current_setting('bill.preserve')::uuid, 'test', 5, '2027-02-01', current_setting('bill.admin_staff')::uuid)
  returning id into edit;
  insert into price_increase_items (organization_id, price_increase_id, mindbody_client_contract_id, mindbody_client_id, contract_name, old_cents, new_cents)
  values (current_setting('bill.preserve')::uuid, edit, 1, current_setting('bill.client'), 'test', 10000, 10500);
  raise notice 'ok   Club Admin: sees contracts, adds and cancels edits, schedules increases';
end $$;
reset role;

rollback;
