-- ============================================================================
-- FAKE seed data for the LOCAL test database. Every name, email and ID here is
-- made up. Loaded by `npm run test:db:setup` after the baseline schema.
--
-- The tests look studios up the way production is shaped, so this creates:
--   - "Test Studio A", standing in for The Preserve (mindbody_site_id 561843,
--     the value the tests search for), with CRM, group fitness and trainer
--     modules on;
--   - "Test Demo Studio" (is_demo), the second studio for multistudio_isolation;
--   - "Test Studio B", standing in for LastSpot under the fixed ID the
--     crm_isolation test uses, with no CRM module.
-- plus the staff roles, sign-in users and rows the 16 tests look for.
--
-- GUARD: this refuses to run unless the database is empty (no organizations,
-- no auth users), so it can never add fake rows to a database that holds real
-- data. scripts/setup-test-db.mjs also refuses any host but localhost.
-- ============================================================================

do $guard$
begin
  if exists (select 1 from public.organizations) or exists (select 1 from auth.users) then
    raise exception 'Refusing to seed: this database already has organizations or users. The fake seed only runs on an empty local test database.';
  end if;
end $guard$;

-- Sign-in users (fake) ---------------------------------------------------------
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-a000-000000000101', 'authenticated', 'authenticated', 'admin@studio-a.test.invalid'),
  ('00000000-0000-4000-a000-000000000103', 'authenticated', 'authenticated', 'trainer-a@studio-a.test.invalid'),
  ('00000000-0000-4000-a000-000000000104', 'authenticated', 'authenticated', 'trainer-b@studio-a.test.invalid');

-- Studios (fake). Inserting a studio also creates its message boards (trigger).
insert into organizations (id, name, mindbody_site_id, timezone, is_demo, created_at) values
  ('00000000-0000-4000-a000-00000000000a', 'Test Studio A', 561843, 'America/Chicago', false, now() - interval '3 days'),
  ('00000000-0000-4000-a000-00000000000d', 'Test Demo Studio', null, 'America/Chicago', true, now() - interval '2 days'),
  ('69b91771-be4b-47cf-a0f5-967b80dcff74', 'Test Studio B', null, 'America/Chicago', false, now() - interval '1 day');

insert into org_modules (organization_id, module) values
  ('00000000-0000-4000-a000-00000000000a', 'crm'),
  ('00000000-0000-4000-a000-00000000000a', 'group_fitness'),
  ('00000000-0000-4000-a000-00000000000a', 'trainer'),
  ('00000000-0000-4000-a000-00000000000d', 'crm'),
  ('00000000-0000-4000-a000-00000000000d', 'group_fitness'),
  ('69b91771-be4b-47cf-a0f5-967b80dcff74', 'group_fitness');

-- Staff (fake) -------------------------------------------------------------------
insert into staff (id, organization_id, first_name, last_name, display_name, active, role, can_sell, is_instructor, is_trainer, auth_user_id) values
  -- Test Studio A
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-00000000000a', 'Ada',   'Admin',   'Ada Admin',   true, 'admin', true,  false, false, '00000000-0000-4000-a000-000000000101'),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-00000000000a', 'Sam',   'Seller',  'Sam Seller',  true, 'sales', true,  false, false, null),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-00000000000a', 'Tara',  'TrainerA','Tara TrainerA', true, 'staff', false, true,  true,  '00000000-0000-4000-a000-000000000103'),
  ('00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-00000000000a', 'Toby',  'TrainerB','Toby TrainerB', true, 'staff', false, true,  true,  '00000000-0000-4000-a000-000000000104'),
  -- Test Demo Studio
  ('00000000-0000-4000-a000-000000000011', '00000000-0000-4000-a000-00000000000d', 'Dana',  'DemoAdmin', 'Dana DemoAdmin', true, 'admin', true, false, false, null),
  -- Test Studio B
  ('00000000-0000-4000-a000-000000000021', '69b91771-be4b-47cf-a0f5-967b80dcff74', 'Bea',   'StudioB', 'Bea StudioB', true, 'staff', false, true, false, null);

-- Classes (fake) -------------------------------------------------------------------
insert into rooms (id, organization_id, name) values
  ('00000000-0000-4000-a000-000000000031', '00000000-0000-4000-a000-00000000000a', 'Test Room');

insert into class_schedules (id, organization_id, class_name, source, room_id) values
  ('00000000-0000-4000-a000-000000000041', '00000000-0000-4000-a000-00000000000a', 'Test Ride', 'synqiq', '00000000-0000-4000-a000-000000000031');

insert into class_sessions (id, organization_id, class_schedule_id, class_name, local_date, start_time, end_time, starts_at, ends_at) values
  ('00000000-0000-4000-a000-000000000051', '00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-000000000041',
   'Test Ride', current_date + 1, '09:00', '09:45', now() + interval '1 day', now() + interval '1 day 45 minutes');

insert into class_occurrences (organization_id, class_name, start_datetime, end_datetime) values
  ('00000000-0000-4000-a000-00000000000a', 'Test Ride', now() - interval '1 day', now() - interval '1 day' + interval '45 minutes'),
  ('00000000-0000-4000-a000-00000000000d', 'Demo Ride', now() - interval '1 day', now() - interval '1 day' + interval '45 minutes');

-- Members and contacts (fake) --------------------------------------------------------
insert into clients (organization_id, mindbody_unique_id, mindbody_client_id, first_name, last_name, status, is_prospect) values
  ('00000000-0000-4000-a000-00000000000a', 100001, '100001', 'Mia', 'Member', 'Active', false);

insert into member_contracts (organization_id, mindbody_client_contract_id, mindbody_client_id, contract_name) values
  ('00000000-0000-4000-a000-00000000000a', 900001, '100001', 'Test Monthly Membership');

insert into crm_contacts (organization_id, first_name, last_name, source) values
  ('00000000-0000-4000-a000-00000000000a', 'Gus', 'Guest', 'walk_in'),
  ('00000000-0000-4000-a000-00000000000d', 'Dee', 'DemoGuest', 'walk_in');

insert into waiver_templates (organization_id, version, body, body_sha256, is_active) values
  ('00000000-0000-4000-a000-00000000000a', 1, 'Test waiver text.', 'test-sha256', true);
