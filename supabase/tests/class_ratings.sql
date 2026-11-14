-- Class ratings: an instructor can't read ratings, requests or opt-outs
-- directly (who rated is Club Admin only; the server shows instructors their
-- own ratings without names). Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  teacher_user uuid := gen_random_uuid();
  teacher uuid := (select id from staff where organization_id = preserve and role = 'staff' and is_instructor order by id limit 1);
  req uuid;
begin
  insert into auth.users (id, aud, role, email) values (teacher_user, 'authenticated', 'authenticated', 'ratings-test@example.invalid');
  update staff set auth_user_id = teacher_user where id = teacher;
  insert into rating_requests (organization_id, mindbody_client_id, client_name, staff_id, class_name, class_style, class_start, quarter, status)
    values (preserve, 'zz-rater', 'Zz Rater', teacher, 'zz class', 'zz', now(), '2026-Q4', 'rated') returning id into req;
  insert into class_ratings (organization_id, request_id, staff_id, mindbody_client_id, client_name, class_name, class_style, class_start, quarter, stars)
    values (preserve, req, teacher, 'zz-rater', 'Zz Rater', 'zz class', 'zz', now(), '2026-Q4', 5);
  perform set_config('cr.user', teacher_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('cr.user'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from class_ratings) then
    raise exception 'An instructor can read ratings directly (would show who rated)';
  end if;
  if exists (select 1 from rating_requests) then
    raise exception 'An instructor can read rating requests';
  end if;
end $$;

rollback;
