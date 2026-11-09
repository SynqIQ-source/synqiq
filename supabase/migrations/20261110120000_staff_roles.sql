-- Staff roles, v2 (lib/permissions.ts has the full access matrix).
--
-- staff.role is now the one access level a staff member has in their studio:
--   admin       Club Admin -- runs the studio: settings, staff and roles,
--               sub approvals, every dashboard. (Value kept as 'admin' so
--               every existing admin check and RLS policy keeps meaning this.)
--   sales_lead  Sales Lead -- every guest and lead, reassigns, marks sold,
--               sees every salesperson's dashboard; can't manage staff.
--   sales       Sales -- only the guests and leads assigned to them, and
--               their own sales numbers.
--   staff       No management or sales access (was 'instructor').
-- Instructor and Trainer are separate tags that combine with any role (and
-- with each other). SynqIQ super admins stay in platform_admins.
--
-- can_sell stays the "counts as a salesperson" switch (seller lists, lead
-- assignment, sales credit): always on for Sales, optional for Club Admins
-- and Sales Leads.

alter table staff drop constraint if exists staff_role_check;

update staff set role = 'staff' where role = 'instructor';
-- Everyone who sells today and isn't an admin becomes Sales.
update staff set role = 'sales' where role = 'staff' and can_sell;

alter table staff alter column role set default 'staff';
alter table staff
  add constraint staff_role_check check (role in ('admin', 'sales_lead', 'sales', 'staff'));
alter table staff
  add constraint staff_sales_role_sells check (role <> 'sales' or can_sell);

alter table staff
  add column if not exists is_instructor boolean not null default false,
  add column if not exists is_trainer boolean not null default false,
  -- Set when a club admin edits the Instructor/Trainer tags; from then on
  -- the nightly auto-detect (lib/staff/teaching-roles.ts) leaves them alone.
  add column if not exists teaching_roles_set_at timestamptz;

-- Auto-detect from the last 180 days of Mindbody data: taught (or subbed) a
-- class -> Instructor; had an appointment -> Trainer.
update staff s
set
  is_instructor = exists (
    select 1 from class_occurrences c
    where (c.staff_id = s.id or c.substitute_staff_id = s.id)
      and c.start_datetime > now() - interval '180 days'
  ),
  is_trainer = exists (
    select 1 from appointment_occurrences a
    where a.staff_id = s.id
      and a.start_datetime > now() - interval '180 days'
  );

create or replace function private.current_staff_can_sell()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select can_sell from staff where auth_user_id = auth.uid()), false);
$$;

-- Club admins, sales leads and anyone who sells may read the org's CRM data.
-- (Sales are further limited to their own guests in the app.)
create or replace function private.can_read_crm(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_org = private.current_staff_org_id()
    and (private.current_staff_role() in ('admin', 'sales_lead') or private.current_staff_can_sell());
$$;

-- Sales leads run the front desk too: they can see the kiosks to set who's
-- on duty (Guests page). Kiosk setup stays club-admin only in the API.
drop policy if exists "kiosk_devices_select_admin" on kiosk_devices;
create policy "kiosk_devices_select_admin"
  on kiosk_devices for select to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() in ('admin', 'sales_lead')
  );
