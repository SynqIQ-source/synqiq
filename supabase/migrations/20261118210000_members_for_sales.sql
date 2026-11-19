-- Members (formerly Memberships) is open to the sales team (Adam,
-- 2026-11-18): Club Admins, Sales Leads and Sales can look up members and
-- see their profile (memberships, visits, purchases, services, signed
-- agreements) and correct contact details. Billing edits, price increases,
-- autopay imports, payment schedules and billing tests stay Club Admin
-- only. Contact-detail changes are logged (member_personal_edits; the log
-- itself is read by Club Admins).

create or replace function private.current_staff_sees_members() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(private.current_staff_role() in ('admin', 'sales_lead', 'sales'), false)
$$;
revoke all on function private.current_staff_sees_members() from public, anon;
grant execute on function private.current_staff_sees_members() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['member_contracts', 'member_visits', 'member_sales', 'member_sale_items', 'member_services',
                           'member_profile_sync', 'member_personal', 'agreement_signatures']
  loop
    execute format('drop policy if exists %I on %I', t || '_select_sales_team', t);
    execute format(
      'create policy %I on %I for select to authenticated using (organization_id = private.current_staff_org_id() and private.current_staff_sees_members())',
      t || '_select_sales_team', t);
  end loop;
end $$;

drop policy if exists member_personal_insert_sales_team on member_personal;
create policy member_personal_insert_sales_team on member_personal for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_sees_members());
drop policy if exists member_personal_update_sales_team on member_personal;
create policy member_personal_update_sales_team on member_personal for update to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_sees_members())
  with check (organization_id = private.current_staff_org_id() and private.current_staff_sees_members());

drop policy if exists member_personal_edits_insert_sales_team on member_personal_edits;
create policy member_personal_edits_insert_sales_team on member_personal_edits for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_sees_members());

-- (An earlier draft also opened payment schedules; they stay Club Admin only.)
drop policy if exists member_billing_schedules_select_sales_team on member_billing_schedules;
