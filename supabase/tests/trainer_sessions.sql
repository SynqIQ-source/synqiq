-- Trainer calendar: staff in the studio see sessions; pay events are Club
-- Admin or own only; nobody writes directly (the API does, after role checks).
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  trainer_user uuid := gen_random_uuid();
  trainer uuid := (select id from staff where organization_id = preserve and role = 'staff' and is_trainer order by id limit 1);
  other uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
  mine uuid;
  theirs uuid;
begin
  insert into auth.users (id, aud, role, email) values (trainer_user, 'authenticated', 'authenticated', 'trainer-cal-test@example.invalid');
  update staff set auth_user_id = trainer_user where id = trainer;
  insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date)
    values (preserve, trainer, 'zz1', 'zz mine', 'PT', now(), now() + interval '50 minutes', current_date) returning id into mine;
  insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date)
    values (preserve, other, 'zz2', 'zz theirs', 'PT', now(), now() + interval '50 minutes', current_date) returning id into theirs;
  insert into payroll_events (organization_id, staff_id, kind, trainer_session_id, work_date, description, amount_cents)
    values (preserve, trainer, 'session', mine, current_date, 'zz mine pay', 100),
           (preserve, other, 'session', theirs, current_date, 'zz theirs pay', 200);
  perform set_config('tc.user', trainer_user::text, true);
  perform set_config('tc.preserve', preserve::text, true);
  perform set_config('tc.trainer', trainer::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tc.user'), 'role', 'authenticated')::text, true);
do $$
begin
  if (select count(*) from trainer_sessions where client_name like 'zz %') <> 2 then
    raise exception 'Staff should see every trainer session in their studio';
  end if;
  if not exists (select 1 from payroll_events where description = 'zz mine pay') then
    raise exception 'A trainer cannot see their own pay event';
  end if;
  if exists (select 1 from payroll_events where description = 'zz theirs pay') then
    raise exception 'A trainer can see someone else''s pay event';
  end if;
  begin
    insert into trainer_sessions (organization_id, trainer_staff_id, mindbody_client_id, client_name, session_type_name, starts_at, ends_at, local_date)
      values (current_setting('tc.preserve')::uuid, current_setting('tc.trainer')::uuid, 'zz3', 'zz', 'PT', now(), now() + interval '1 hour', current_date);
    raise exception 'A trainer could write a session directly (should go through the API)';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update payroll_events set amount_cents = 999999 where description = 'zz mine pay';
    if exists (select 1 from payroll_events where amount_cents = 999999) then
      raise exception 'A trainer could change their own pay';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
