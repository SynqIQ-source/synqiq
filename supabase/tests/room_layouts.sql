-- Room layouts: staff of the studio can read them, nobody writes directly,
-- and one person per spot per class. Rolls back.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  staff_user uuid := gen_random_uuid();
  some_staff uuid := (select id from staff where organization_id = preserve and role = 'sales' order by id limit 1);
  room uuid := (select id from rooms where organization_id = preserve order by id limit 1);
  session uuid := (select id from class_sessions where organization_id = preserve order by id limit 1);
begin
  insert into auth.users (id, aud, role, email) values (staff_user, 'authenticated', 'authenticated', 'room-layout-test@example.invalid');
  update staff set auth_user_id = staff_user where id = some_staff;
  delete from room_layouts where room_id = room;
  insert into room_layouts (organization_id, room_id, items, spot_noun) values (preserve, room, '[{"id":"s1","kind":"spot","x":0,"y":0,"label":"1"}]', 'zzBike');

  insert into class_bookings (organization_id, class_session_id, mindbody_client_id, client_name, status, spot_id, spot_label, coverage_kind)
    values (preserve, session, 'zz-a', 'zz A', 'booked', 's1', 'Bike 1', 'membership');
  begin
    insert into class_bookings (organization_id, class_session_id, mindbody_client_id, client_name, status, spot_id, spot_label, coverage_kind)
      values (preserve, session, 'zz-b', 'zz B', 'booked', 's1', 'Bike 1', 'membership');
    raise exception 'Two people could book the same spot';
  exception when unique_violation then
    null;
  end;
  -- A cancelled booking frees the spot.
  update class_bookings set status = 'cancelled' where class_session_id = session and mindbody_client_id = 'zz-a';
  insert into class_bookings (organization_id, class_session_id, mindbody_client_id, client_name, status, spot_id, spot_label, coverage_kind)
    values (preserve, session, 'zz-b', 'zz B', 'booked', 's1', 'Bike 1', 'membership');
  perform set_config('rl.user', staff_user::text, true);
  perform set_config('rl.room', room::text, true);
  perform set_config('rl.preserve', preserve::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('rl.user'), 'role', 'authenticated')::text, true);
do $$
begin
  if not exists (select 1 from room_layouts where spot_noun = 'zzBike') then
    raise exception 'Staff cannot see their studio''s room layout';
  end if;
  begin
    update room_layouts set spot_noun = 'hacked' where spot_noun = 'zzBike';
    if exists (select 1 from room_layouts where spot_noun = 'hacked') then
      raise exception 'Staff could change a room layout directly';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
