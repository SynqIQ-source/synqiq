-- Members' personal information. `mindbody` is Mindbody's copy (refreshed
-- by sync; Mindbody owns member records until the switch). `edits` holds
-- fields changed in SynqIQ: they win over Mindbody's copy and a sync never
-- overwrites them. SynqIQ does not write to Mindbody, so an edit made here
-- isn't in Mindbody. Every edit is logged in member_personal_edits.
-- Club Admins only; Mindbody's copy is written by the service role.

create table if not exists member_personal (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  -- {firstName, lastName, email, mobilePhone, homePhone, addressLine1,
  --  addressLine2, city, state, postalCode, birthDate, photoUrl,
  --  emergencyContactName, emergencyContactPhone}
  mindbody jsonb not null default '{}'::jsonb,
  mindbody_synced_at timestamptz,
  edits jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  edited_by_staff_id uuid references staff (id),
  primary key (organization_id, mindbody_client_id)
);

create table if not exists member_personal_edits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  changes jsonb not null, -- {field: {from, to}}
  edited_by_staff_id uuid not null references staff (id),
  created_at timestamptz not null default now()
);
create index if not exists member_personal_edits_client_idx on member_personal_edits (organization_id, mindbody_client_id, created_at desc);

alter table member_personal enable row level security;
alter table member_personal_edits enable row level security;

create policy "member_personal_select_club_admin" on member_personal for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_personal_insert_club_admin" on member_personal for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_personal_update_club_admin" on member_personal for update to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin')
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_personal_edits_select_club_admin" on member_personal_edits for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_personal_edits_insert_club_admin" on member_personal_edits for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

-- Move what the per-member refresh already pulled.
insert into member_personal (organization_id, mindbody_client_id, mindbody, mindbody_synced_at)
select organization_id, mindbody_client_id, personal, synced_at
from member_profile_sync
where personal <> '{}'::jsonb
on conflict (organization_id, mindbody_client_id) do nothing;

alter table member_profile_sync drop column if exists personal;
