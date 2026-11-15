-- Team boards: Sales see the Sales board (not Trainers); trainers see the
-- Trainers board (not Sales). Deleted posts stay in the table. Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  sales_user uuid := gen_random_uuid();
  trainer_user uuid := gen_random_uuid();
  sales_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' and not is_trainer order by id limit 1);
  trainer_staff uuid := (select id from staff where organization_id = preserve and role = 'staff' and is_trainer and not can_sell order by id limit 1);
begin
  insert into auth.users (id, aud, role, email) values (sales_user, 'authenticated', 'authenticated', 'team-sales@example.invalid');
  insert into auth.users (id, aud, role, email) values (trainer_user, 'authenticated', 'authenticated', 'team-trainer@example.invalid');
  update staff set auth_user_id = sales_user where id = sales_staff;
  update staff set auth_user_id = trainer_user where id = trainer_staff;
  perform set_config('tb.sales', sales_user::text, true);
  perform set_config('tb.trainer', trainer_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('tb.sales'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from message_boards where board_type = 'team_sales') then
    raise exception 'Sales cannot see the Sales board';
  end if;
  if exists (select 1 from message_boards where board_type = 'team_trainers') then
    raise exception 'Sales can see the Trainers board';
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('tb.trainer'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from message_boards where board_type = 'team_trainers') then
    raise exception 'A trainer cannot see the Trainers board';
  end if;
  if exists (select 1 from message_boards where board_type = 'team_sales') then
    raise exception 'A trainer can see the Sales board';
  end if;
end $$;

rollback;
