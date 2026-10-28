-- CRM add-on, Phase 1: guest check-in kiosk, versioned waivers, Guests page.
--
-- Design notes:
--   - Every table is organization-scoped. Staff can READ their own org's CRM
--     data only if they're an admin or have staff.can_sell. All WRITES go
--     through server API routes (service role) that resolve the org from
--     either the staff session or a kiosk device token -- never from the
--     request body -- so there are no INSERT/UPDATE/DELETE policies for
--     `authenticated` on the CRM tables.
--   - Waivers are kept indefinitely: waiver_signatures and published
--     waiver_templates are protected by triggers that block UPDATE (except
--     a template's is_active flag) and DELETE for every role, including the
--     service role. There is no delete policy anywhere.
--   - The kiosk never holds a staff login. A device is paired with a
--     one-time activation code issued by an admin; only hashes of the code
--     and the long-lived device token are stored.
--   - A contact is deliberately not a "staff" row and conversations aren't
--     built yet, so a future non-human participant (an AI assistant) can be
--     added without reshaping these tables.

begin;

-- === staff.can_sell ============================================================

alter table staff add column can_sell boolean not null default false;
comment on column staff.can_sell is
  'Admin-editable: this staff member sells memberships (appears in the kiosk "Who are you meeting?" list and can see CRM data).';

-- === helpers ==================================================================

create or replace function private.current_staff_can_sell()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select can_sell from staff where auth_user_id = auth.uid()), false);
$$;

-- Admins and sales staff (staff.can_sell) of the row's org may read CRM data.
create or replace function private.can_read_crm(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_org = private.current_staff_org_id()
    and (private.current_staff_role() = 'admin' or private.current_staff_can_sell());
$$;

-- Shared guard: the table this is attached to can never have rows deleted.
create or replace function private.prevent_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are kept indefinitely and cannot be deleted', tg_table_name;
end;
$$;

-- === org_modules ===============================================================

create table org_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  module text not null check (module in ('crm')),
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  created_at timestamptz not null default now(),
  unique (organization_id, module)
);
alter table org_modules enable row level security;
create policy "org_modules_select_same_org"
  on org_modules for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- === kiosk_devices ============================================================

create table kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null check (char_length(name) between 1 and 80),
  activation_code_hash text unique,
  activation_expires_at timestamptz,
  token_hash text unique,
  activated_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now()
);
alter table kiosk_devices enable row level security;
create policy "kiosk_devices_select_admin"
  on kiosk_devices for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

-- Short-lived, single-use handle for an "Is this you?" match, so the kiosk
-- never receives a contact id.
create table kiosk_match_tokens (
  token_hash text primary key,
  organization_id uuid not null references organizations (id),
  kiosk_device_id uuid not null references kiosk_devices (id),
  contact_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table kiosk_match_tokens enable row level security; -- server only, no policies

-- === rate limiting ============================================================

create table rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table rate_limit_counters enable row level security; -- server only, no policies

-- Atomically counts one hit for `p_key` in the current fixed window and
-- returns true while the count is within `p_limit`. Server (service role) only.
create or replace function public.crm_rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into rate_limit_counters as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  delete from rate_limit_counters where window_start < now() - interval '2 days';
  return v_count <= p_limit;
end;
$$;
revoke all on function public.crm_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_rate_limit_hit(text, integer, integer) to service_role;

-- === marketing sources ("How did you hear about us?") ========================

create table crm_marketing_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  label text not null check (char_length(label) between 1 and 60),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, label)
);
alter table crm_marketing_sources enable row level security;
create policy "crm_marketing_sources_select_same_org"
  on crm_marketing_sources for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- === waiver templates (versioned, immutable once published) ==================

create table waiver_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  version integer not null check (version > 0),
  body text not null check (char_length(body) > 0),
  body_sha256 text not null,
  is_active boolean not null default false,
  published_at timestamptz not null default now(),
  created_by_staff_id uuid references staff (id),
  unique (organization_id, version)
);
create unique index waiver_templates_one_active_per_org on waiver_templates (organization_id) where is_active;
alter table waiver_templates enable row level security;
create policy "waiver_templates_select_crm"
  on waiver_templates for select to authenticated
  using (private.can_read_crm(organization_id));

create or replace function private.waiver_templates_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     or new.body_sha256 is distinct from old.body_sha256
     or new.version is distinct from old.version
     or new.organization_id is distinct from old.organization_id
     or new.published_at is distinct from old.published_at then
    raise exception 'A published waiver version cannot be changed; publish a new version instead';
  end if;
  return new;
end;
$$;
create trigger waiver_templates_immutable before update on waiver_templates
  for each row execute function private.waiver_templates_immutable();
create trigger waiver_templates_no_delete before delete on waiver_templates
  for each row execute function private.prevent_delete();

-- === contacts =================================================================

create table crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  email text,
  email_normalized text,
  phone_e164 text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  status text not null default 'guest' check (status in ('guest', 'lead', 'member')),
  source text not null check (source in ('walk_in', 'guest_of_member', 'phone_in', 'other')),
  how_heard text[] not null default '{}',
  referring_client_id uuid references clients (id),
  referrer_name_typed text,
  referrer_unresolved boolean not null default false,
  photo_path text,
  assigned_staff_id uuid references staff (id),
  email_consent boolean not null default false,
  email_consent_at timestamptz,
  sms_consent boolean not null default false,
  sms_consent_at timestamptz,
  photo_consent boolean not null default false,
  photo_consent_at timestamptz,
  email_check_status text not null default 'pending'
    check (email_check_status in ('pending', 'deliverable', 'undeliverable', 'risky', 'unknown', 'skipped')),
  email_check_result jsonb,
  email_checked_at timestamptz,
  mindbody_client_id text,
  mindbody_sync_status text not null default 'not_synced'
    check (mindbody_sync_status in ('not_synced', 'pending', 'synced', 'failed', 'member_review')),
  possible_duplicate_of uuid references crm_contacts (id),
  merged_into_id uuid references crm_contacts (id),
  created_by_staff_id uuid references staff (id),
  created_by_kiosk_device_id uuid references kiosk_devices (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_contacts_org_email_idx on crm_contacts (organization_id, email_normalized);
create index crm_contacts_org_phone_idx on crm_contacts (organization_id, phone_e164);
create index crm_contacts_org_created_idx on crm_contacts (organization_id, created_at desc);
alter table crm_contacts enable row level security;
create policy "crm_contacts_select_crm"
  on crm_contacts for select to authenticated
  using (private.can_read_crm(organization_id));
create trigger crm_contacts_no_delete before delete on crm_contacts
  for each row execute function private.prevent_delete();

-- === visits ===================================================================

create table guest_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  contact_id uuid not null references crm_contacts (id),
  visit_at timestamptz not null default now(),
  visit_type text not null check (visit_type in ('appointment', 'trial_visit', 'walk_in', 'guest_visit')),
  assigned_staff_id uuid references staff (id),
  kiosk_device_id uuid references kiosk_devices (id),
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now()
);
create index guest_visits_org_visit_idx on guest_visits (organization_id, visit_at desc);
create index guest_visits_contact_idx on guest_visits (contact_id);
alter table guest_visits enable row level security;
create policy "guest_visits_select_crm"
  on guest_visits for select to authenticated
  using (private.can_read_crm(organization_id));

-- === waiver signatures (kept indefinitely, immutable) ========================

create table waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  contact_id uuid not null references crm_contacts (id),
  visit_id uuid references guest_visits (id),
  template_id uuid not null references waiver_templates (id),
  template_version integer not null,
  template_sha256 text not null,
  signed_at timestamptz not null default now(),
  signer_ip text,
  signer_user_agent text,
  typed_name text not null,
  agreed boolean not null check (agreed),
  is_minor boolean not null default false,
  guardian_name text,
  signature_path text not null,
  guardian_signature_path text,
  pdf_path text not null,
  pdf_sha256 text not null,
  kiosk_device_id uuid references kiosk_devices (id),
  created_at timestamptz not null default now(),
  check (not is_minor or (guardian_name is not null and guardian_signature_path is not null))
);
create index waiver_signatures_contact_idx on waiver_signatures (contact_id);
alter table waiver_signatures enable row level security;
create policy "waiver_signatures_select_crm"
  on waiver_signatures for select to authenticated
  using (private.can_read_crm(organization_id));

create or replace function private.waiver_signatures_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Signed waivers cannot be changed';
end;
$$;
create trigger waiver_signatures_immutable before update on waiver_signatures
  for each row execute function private.waiver_signatures_immutable();
create trigger waiver_signatures_no_delete before delete on waiver_signatures
  for each row execute function private.prevent_delete();

-- === pending matches (staff resolve on the Guests page) ======================

create table crm_pending_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  submitted_contact_id uuid not null references crm_contacts (id),
  candidate_contact_id uuid not null references crm_contacts (id),
  reason text not null check (reason in ('partial_match', 'name_mismatch', 'declined_match')),
  status text not null default 'open' check (status in ('open', 'merged', 'kept_separate')),
  resolved_by_staff_id uuid references staff (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index crm_pending_matches_org_open_idx on crm_pending_matches (organization_id) where status = 'open';
alter table crm_pending_matches enable row level security;
create policy "crm_pending_matches_select_crm"
  on crm_pending_matches for select to authenticated
  using (private.can_read_crm(organization_id));

-- === background jobs (email check / Mindbody push -- wired up later) ========

create table crm_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  kind text not null check (kind in ('email_check', 'mindbody_push')),
  contact_id uuid not null references crm_contacts (id),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_jobs_due_idx on crm_jobs (next_run_at) where status = 'queued';
alter table crm_jobs enable row level security; -- server only, no policies

-- === private storage: photos, signatures, waiver PDFs ========================
-- Paths: {organization_id}/photos/..., {organization_id}/waivers/...
-- Uploads happen server-side only. Same-org admins/sales staff can read (the
-- app hands out short-lived signed URLs). No delete policy.

insert into storage.buckets (id, name, public)
values ('crm-private', 'crm-private', false)
on conflict (id) do nothing;

create policy "crm_private_read_crm_staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'crm-private'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
    and (private.current_staff_role() = 'admin' or private.current_staff_can_sell())
  );

-- === grants for helper functions ============================================

revoke all on function private.current_staff_can_sell() from public, anon;
revoke all on function private.can_read_crm(uuid) from public, anon;
grant execute on function private.current_staff_can_sell() to authenticated;
grant execute on function private.can_read_crm(uuid) to authenticated;

-- === seed: The Preserve (mindbody site 561843) ==============================

insert into org_modules (organization_id, module, status)
select id, 'crm', 'enabled' from organizations where mindbody_site_id = 561843
on conflict (organization_id, module) do nothing;

insert into crm_marketing_sources (organization_id, label, sort_order)
select o.id, v.label, v.sort_order
from organizations o
cross join (values
  ('Google', 1), ('Instagram', 2), ('TikTok', 3), ('Snapchat', 4), ('ChatGPT', 5), ('Claude', 6),
  ('Grok', 7), ('Friend or family', 8), ('Drive by', 9), ('Online article', 10), ('Local event', 11)
) as v (label, sort_order)
where o.mindbody_site_id = 561843
on conflict (organization_id, label) do nothing;

-- Waiver version 1, verbatim from docs/waiver-v1.txt.
insert into waiver_templates (organization_id, version, body, body_sha256, is_active)
select o.id, 1, w.body, encode(extensions.digest(w.body, 'sha256'), 'hex'), true
from organizations o
cross join (select $waiver$INDEMNIFICATION AND RELEASE OF LIABILITY

IN CONSIDERATION of being permitted to utilize the exercise/fitness equipment (the “Equipment”) provided by THE PRESERVE GYM LLC dba The Preserve (“The Preserve”) at 3303 Audley Houston, Texas (the “Facilities”, which shall also include, without limitation, any other areas where I exercise or train with any of The Preserve’s personnel or subcontractors), and to participate in various exercise and fitness activities at the Facilities, I hereby expressly, irrevocably and unconditionally acknowledge and agree (on behalf of myself and my representatives, beneficiaries and heirs) to the following provisions contained in this Indemnification and Release of Liability (the “Release”):

1. I agree to expressly RELEASE, INDEMNIFY AND HOLD HARMLESS The Preserve (which shall include, without limitation, any owner, officer, employee, representative, agent, contractor and/or any other affiliate of The Preserve) from and against any and all claims, demands, actions, liabilities, costs, expenses, and/or damages asserted against, imposed upon or incurred by The Preserve on account of death or injury to any person (including, without limitation, my own person), or damage to or theft of any property (including, without limitation, my own property) arising from or in connection with, or as a result of my use of the Equipment, my participation in any exercise or fitness activities at the Facilities or any related activities, or my presence at, on or around the Facilities. I expressly acknowledge and agree that The Preserve shall not be held responsible in any manner for any property lost, stolen or damaged while at, on or around the Premises or otherwise. I further agree to pay The Preserve’s court costs, reasonable attorneys’ fees incurred and all other associated costs arising out of or in connection with such claims, demands, actions, liabilities, costs, expenses, and/or damages including, without limitation, all costs incurred in establishing the enforceability of this Release. I expressly, irrevocably and unconditionally agree that the terms and provisions of this Release shall apply WITHOUT REGARD TO WHETHER THE CLAIM, DEMAND, ACTIONS, LIABILITY, COST, EXPENSE, AND/OR DAMAGE IS BASED ON THE NEGLIGENCE OR INTENTIONAL MISCONDUCT OF MYSELF OR ANY OTHER PARTY OR WHETHER BASED ON BREACH OF CONTRACT, BREACH OF WARRANTY, STRICT LIABILITY OR ANY OTHER TORT. I HEREBY EXPRESSLY, IRREVOCABLY AND UNCONDITIONALLY ACKNOWLEDGE AND AGREE THAT THIS SECTION SHALL SURVIVE THE TERMINATION OF THIS RELEASE, THE TERMINATION OF MY MEMBERSHIP AT THE PRESERVE OR OTHERWISE.

2. I am aware that there are inherent and other risks (including potential serious injury, permanent disability and death) involved in my use of the Equipment and my participation in the exercise and fitness activities. I expressly acknowledge that The Preserve does not provide any ongoing supervision, instruction or assistance outside of personal training services and scheduled group fitness instruction relating to the use of the Equipment or the exercise and fitness activities. I therefore knowingly, freely, expressly, irrevocably and unconditionally agree to assume all such risks, whether known or unknown, EVEN IF ARISING FROM THE NEGLIGENCE OR INTENTIONAL MISCONDUCT of The Preserve (which shall include, without limitation, any owner, officer, employee, representative, agent, contractor and/or any other affiliate of The Preserve) and assume full responsibility for my use of the Equipment, my participation in any exercise and fitness activities and/or any activity incident thereto.

3. I expressly agree to comply with all rules and regulations imposed by The Preserve regarding the use of the Facilities and the Equipment. I agree to conduct myself in a controlled and reasonable manner at all times and to refrain from using the Equipment in a manner that is inconsistent with its intended design and purpose.

4. I understand that this Release shall be governed by the laws of the State of Texas, without giving effect to the conflicts of law principles of any state. I hereby irrevocably consent to be subject to the personal jurisdiction of any United States, state, or local court sitting in Harris County, Houston, Texas in connection with any action to determine any dispute arising under this Release or to enforce the provisions hereof.

5. I understand that whenever possible, each provision of this Release shall be interpreted in such manner as to be effective and valid under applicable law, but if any provision (or any section of any provision) of this Release is held to be prohibited by or invalid under applicable law, such provision (or any section of any provision) shall be ineffective only to the extent of such prohibition or invalidity, without invalidating the remainder of such provision or the remaining provisions of this Release.

6. I expressly agree that all the provisions of this Release shall survive the termination of this Release, the termination of my membership at The Preserve or otherwise.

I HAVE READ THIS INDEMNIFICATION AND RELEASE OF LIABILITY, AND I FULLY UNDERSTAND ITS TERMS. I UNDERSTAND THAT I AM GIVING UP SUBSTANTIAL RIGHTS BY SIGNING THIS RELEASE AND ACKNOWLEDGE THAT I HAVE SIGNED IT FREELY AND VOLUNTARILY.$waiver$::text as body) w
where o.mindbody_site_id = 561843
on conflict (organization_id, version) do nothing;

commit;
