-- Trainer sessions pilot (migration 20261123120000): who sees what, and the
-- database rules that keep pay and balances honest. Invented data only; runs
-- only against the local test database (see README.md). Ends in ROLLBACK.
--   - every trainer sees every trainer's sessions in their studio, but only
--     their own pay lines; no rates, no pay periods
--   - Club Admins see all of it for their studio
--   - another studio sees none of it
--   - nobody signed in writes rates, periods or pay lines directly
--   - a locked period can't gain, change or lose a line, or be reopened
--   - one charge and one reversal per close-out (retries can't double up)
--   - the balance "since sync" counts only entries after the last refresh
-- Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  demo uuid := (select id from organizations where is_demo limit 1);
  admin_staff uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
  trainer_a uuid := (select id from staff where organization_id = preserve and role = 'staff' and is_trainer order by id limit 1);
  trainer_b uuid := (select id from staff where organization_id = preserve and role = 'staff' and is_trainer order by id offset 1 limit 1);
  demo_admin uuid := (select id from staff where organization_id = demo and role = 'admin' order by id limit 1);
  demo_user uuid := gen_random_uuid();
  open_period uuid;
  demo_period uuid;
  s_a uuid;
  s_b uuid;
  s_demo uuid;
  line_a uuid;
  pack uuid;
begin
  if trainer_a is null or trainer_b is null or demo_admin is null then
    raise exception 'Seed needs two trainers at Test Studio A and a Demo Studio admin';
  end if;
  insert into auth.users (id, aud, role, email) values (demo_user, 'authenticated', 'authenticated', 'pilot-demo@example.invalid');
  update staff set auth_user_id = demo_user where id = demo_admin;

  insert into pay_periods (organization_id, starts_on, ends_on) values (preserve, '2026-11-21', '2026-12-04') returning id into open_period;
  insert into pay_periods (organization_id, starts_on, ends_on) values (demo, '2026-11-21', '2026-12-04') returning id into demo_period;

  insert into trainer_session_rates (organization_id, staff_id, method, percent_bp, flat_cents, effective_from)
    values (preserve, trainer_a, 'percent', 6500, null, '2026-11-01'), (preserve, trainer_b, 'flat', null, 2000, '2026-11-01');
  insert into trainer_session_rates (organization_id, staff_id, method, flat_cents, effective_from)
    values (demo, demo_admin, 'flat', 1500, '2026-11-01');

  insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date, status, close_no)
    values (preserve, trainer_a, 'zz-pilot-1', 'zz Pilot One', 'PT 50', now() - interval '2 hours', now() - interval '70 minutes', current_date, 'completed', 1)
    returning id into s_a;
  insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date, status, close_no)
    values (preserve, trainer_b, 'zz-pilot-2', 'zz Pilot Two', 'PT 50', now() - interval '2 hours', now() - interval '70 minutes', current_date, 'completed', 1)
    returning id into s_b;
  insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date, status, close_no)
    values (demo, demo_admin, 'zz-pilot-3', 'zz Pilot Three', 'PT 50', now() - interval '2 hours', now() - interval '70 minutes', current_date, 'completed', 1)
    returning id into s_demo;

  insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, work_date, description, amount_cents, pay_period_id)
    values (preserve, trainer_a, 'session', s_a, 1, current_date, 'zz pilot A', 5688, open_period) returning id into line_a;
  insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, reverses_event_id, reason, work_date, description, amount_cents, pay_period_id)
    values (preserve, trainer_a, 'session', s_a, 1, line_a, 'zz test correction', current_date, 'zz pilot A reversal', -5688, open_period);
  insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, work_date, description, amount_cents, pay_period_id)
    values (preserve, trainer_b, 'session', s_b, 1, current_date, 'zz pilot B', 2000, open_period);
  insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, work_date, description, amount_cents, pay_period_id)
    values (demo, demo_admin, 'session', s_demo, 1, current_date, 'zz pilot demo', 1500, demo_period);

  -- Retries can't add a second charge or a second reversal for a close-out.
  begin
    insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, work_date, description, amount_cents)
      values (preserve, trainer_a, 'session', s_a, 1, current_date, 'zz duplicate', 5688);
    raise exception 'FAIL a second pay line for the same close-out was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, close_no, reverses_event_id, work_date, description, amount_cents)
      values (preserve, trainer_a, 'session', s_a, 1, line_a, current_date, 'zz duplicate reversal', -5688);
    raise exception 'FAIL a second reversal of the same pay line was accepted';
  exception when unique_violation then null;
  end;

  -- Session ledger: one charge per close-out, one reversal per charge; the
  -- "since sync" balance ignores entries made before the last Mindbody refresh.
  insert into session_packs (organization_id, mindbody_client_id, name, kind, total_sessions, opening_remaining, source, mindbody_client_service_id, refreshed_at)
    values (preserve, 'zz-pilot-1', 'zz PT 10PK', 'pt', 10, 6, 'mindbody', 'zz-svc-1', now() - interval '1 hour')
    returning id into pack;
  insert into session_pack_uses (organization_id, session_pack_id, trainer_session_id, close_no, kind, sessions, created_at)
    values (preserve, pack, s_a, 1, 'completed', -1, now() - interval '2 hours');
  insert into session_pack_uses (organization_id, session_pack_id, kind, sessions, created_at)
    values (preserve, pack, 'adjustment', -1, now() - interval '10 minutes');
  begin
    insert into session_pack_uses (organization_id, session_pack_id, trainer_session_id, close_no, kind, sessions)
      values (preserve, pack, s_a, 1, 'completed', -1);
    raise exception 'FAIL a second session use for the same close-out was accepted';
  exception when unique_violation then null;
  end;
  if (select remaining from session_pack_balances where id = pack) <> 4 then
    raise exception 'FAIL balance should be 6 - 2 = 4, got %', (select remaining from session_pack_balances where id = pack);
  end if;
  if (select remaining_since_sync from session_pack_balances where id = pack) <> 5 then
    raise exception 'FAIL balance since sync should count only the entry after the refresh (6 - 1 = 5), got %',
      (select remaining_since_sync from session_pack_balances where id = pack);
  end if;

  -- A locked period is final.
  update pay_periods set status = 'locked', locked_at = now() where id = open_period;
  begin
    insert into payroll_events (organization_id, staff_id, kind, work_date, description, amount_cents, pay_period_id)
      values (preserve, trainer_b, 'session', current_date, 'zz into locked', 100, open_period);
    raise exception 'FAIL a pay line was added to a locked period';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update payroll_events set amount_cents = 1 where id = line_a;
    raise exception 'FAIL a pay line in a locked period was changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from payroll_events where id = line_a;
    raise exception 'FAIL a pay line in a locked period was deleted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    update pay_periods set status = 'open' where id = open_period;
    raise exception 'FAIL a locked period was reopened';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  perform set_config('pilot.trainer_a', (select auth_user_id::text from staff where id = trainer_a), true);
  perform set_config('pilot.trainer_a_staff', trainer_a::text, true);
  perform set_config('pilot.admin', (select auth_user_id::text from staff where id = admin_staff), true);
  perform set_config('pilot.demo_user', demo_user::text, true);
  perform set_config('pilot.preserve', preserve::text, true);
end $$;

-- --- Trainer A ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pilot.trainer_a'), 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from trainer_sessions where client_name like 'zz Pilot%') <> 2 then
    raise exception 'FAIL a trainer should see every trainer''s sessions in their studio (and none elsewhere): saw %',
      (select count(*) from trainer_sessions where client_name like 'zz Pilot%');
  end if;
  if exists (select 1 from payroll_events where staff_id <> current_setting('pilot.trainer_a_staff')::uuid) then
    raise exception 'FAIL a trainer can see another trainer''s pay lines';
  end if;
  if (select count(*) from payroll_events where description like 'zz pilot A%') <> 2 then
    raise exception 'FAIL a trainer should see their own pay line and its reversal';
  end if;
  if exists (select 1 from trainer_session_rates) then
    raise exception 'FAIL a trainer can see session rates';
  end if;
  if exists (select 1 from pay_periods) then
    raise exception 'FAIL a trainer can see pay periods';
  end if;
  begin
    insert into trainer_session_rates (organization_id, staff_id, method, flat_cents, effective_from)
      values (current_setting('pilot.preserve')::uuid, current_setting('pilot.trainer_a_staff')::uuid, 'flat', 99999, '2026-01-01');
    raise exception 'FAIL a trainer could set their own rate';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into payroll_events (organization_id, staff_id, kind, work_date, description, amount_cents)
      values (current_setting('pilot.preserve')::uuid, current_setting('pilot.trainer_a_staff')::uuid, 'session', current_date, 'zz self pay', 99999);
    raise exception 'FAIL a trainer could write a pay line';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- --- Club Admin ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pilot.admin'), 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from trainer_session_rates) <> 2 then
    raise exception 'FAIL a Club Admin should see the studio''s 2 rates (and not the other studio''s): saw %', (select count(*) from trainer_session_rates);
  end if;
  if (select count(*) from pay_periods) <> 1 then
    raise exception 'FAIL a Club Admin should see the studio''s pay period only';
  end if;
  if (select count(*) from payroll_events where description like 'zz pilot%') <> 3 then
    raise exception 'FAIL a Club Admin should see every pay line in the studio (3): saw %', (select count(*) from payroll_events where description like 'zz pilot%');
  end if;
  begin
    insert into pay_periods (organization_id, starts_on, ends_on) values (current_setting('pilot.preserve')::uuid, '2027-01-02', '2027-01-15');
    raise exception 'FAIL a Club Admin wrote a pay period directly (should go through the API)';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- --- Another studio's admin: nothing ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('pilot.demo_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from trainer_sessions where organization_id = current_setting('pilot.preserve')::uuid)
     or exists (select 1 from payroll_events where organization_id = current_setting('pilot.preserve')::uuid)
     or exists (select 1 from trainer_session_rates where organization_id = current_setting('pilot.preserve')::uuid)
     or exists (select 1 from pay_periods where organization_id = current_setting('pilot.preserve')::uuid)
     or exists (select 1 from session_pack_balances where organization_id = current_setting('pilot.preserve')::uuid) then
    raise exception 'FAIL another studio can see Test Studio A''s trainer sessions, pay, rates, periods or balances';
  end if;
  if not exists (select 1 from trainer_sessions where client_name = 'zz Pilot Three') then
    raise exception 'FAIL the other studio can''t see its own session, so the test proves nothing';
  end if;
end $$;
reset role;

rollback;
