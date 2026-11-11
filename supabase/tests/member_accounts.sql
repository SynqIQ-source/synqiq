-- Member accounts, sessions and sign-in links are server-only: even a Club
-- Admin signed in through RLS can't read password hashes, sessions or
-- tokens. Testers are readable by the studio's staff.
--
-- Runs inside one transaction and ROLLS BACK, so it is safe against
-- production. Any failed check raises an exception.

begin;

do $$
declare
  preserve uuid := (select id from organizations where mindbody_site_id = 561843);
  admin_user uuid := gen_random_uuid();
  admin_staff uuid := (select id from staff where organization_id = preserve and role = 'admin' order by id limit 1);
  account uuid;
begin
  if admin_staff is null then
    raise exception 'Need a Club Admin at The Preserve';
  end if;
  insert into auth.users (id, aud, role, email) values (admin_user, 'authenticated', 'authenticated', 'member-test-admin@example.invalid');
  update staff set auth_user_id = admin_user where id = admin_staff;
  insert into member_accounts (organization_id, mindbody_client_id, email, password_hash)
    values (preserve, 'test-member-0001', 'member-test@example.invalid', 'scrypt$16384$8$1$x$y')
    returning id into account;
  insert into member_sessions (account_id, token_hash, expires_at) values (account, 'test-session-hash', now() + interval '1 day');
  insert into member_tokens (account_id, token_hash, expires_at) values (account, 'test-token-hash', now() + interval '1 hour');
  insert into member_portal_testers (organization_id, mindbody_client_id, client_name) values (preserve, 'test-member-0001', 'Test Member');
  perform set_config('mem.admin_user', admin_user::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('mem.admin_user'), 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from member_accounts) then
    raise exception 'Club Admin can read member accounts (password hashes)';
  end if;
  if exists (select 1 from member_sessions) or exists (select 1 from member_tokens) then
    raise exception 'Club Admin can read member sessions or sign-in links';
  end if;
  if not exists (select 1 from member_portal_testers where mindbody_client_id = 'test-member-0001') then
    raise exception 'Club Admin cannot see the testers list';
  end if;
  begin
    insert into member_portal_testers (organization_id, mindbody_client_id, client_name)
      values ((select organization_id from member_portal_testers limit 1), 'test-member-0002', 'Sneaky');
    raise exception 'Staff could add a tester directly (should go through the API)';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
