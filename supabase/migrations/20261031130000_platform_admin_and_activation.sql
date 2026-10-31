-- Platform admin + Mindbody activation (lib/platform/admin.ts,
-- lib/mindbody/activation.ts).
--
-- Platform admins run SynqIQ itself: add studios and connect their Mindbody
-- sites. Not the same as a studio's own admins. Only the service role reads
-- this table (no RLS policies), so it can't be read or changed from the app.
--
-- A new studio approves Synq in Mindbody through an activation link. The code
-- and link are stored on the organization; whether it's approved is checked
-- live against Mindbody (the site shows up in GET /site/sites).

begin;

create table platform_admins (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;

-- Adam (johnahorak@gmail.com).
insert into platform_admins (auth_user_id) values ('c5a139e0-33d8-412a-b771-fe862ca562b4');

alter table organizations
  add column mindbody_activation_code text,
  add column mindbody_activation_link text,
  add column mindbody_activation_checked_at timestamptz,
  add column mindbody_activated_at timestamptz;

commit;
