-- CRM sales dashboard: closes (enrollments), appointments, logged calls, and
-- a Web lead source.
begin;

-- A guest/lead becomes a sale ("closed") either by staff ("Mark sold") or
-- automatically when their linked Mindbody client turns Active.
alter table crm_contacts add column closed_at timestamptz;
alter table crm_contacts add column closed_by_staff_id uuid references staff (id);
alter table crm_contacts add column close_source text check (close_source in ('manual', 'mindbody'));
-- Linked to a Mindbody client who was ALREADY an Active member: never
-- auto-counted as a new sale.
alter table crm_contacts add column mindbody_member_at_link boolean not null default false;

alter table crm_contacts drop constraint crm_contacts_source_check;
alter table crm_contacts add constraint crm_contacts_source_check
  check (source in ('walk_in', 'guest_of_member', 'phone_in', 'web', 'other'));

-- Logged phone calls live in the guest's thread (body = call notes).
alter table crm_messages drop constraint crm_messages_channel_check;
alter table crm_messages add constraint crm_messages_channel_check check (channel in ('sms', 'email', 'call'));

-- The salesperson working the front desk on this iPad. A returning guest who
-- checks in there is reassigned to them.
alter table kiosk_devices add column on_duty_staff_id uuid references staff (id);
alter table kiosk_devices add column on_duty_set_at timestamptz;

create table crm_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  contact_id uuid not null references crm_contacts (id),
  -- Who the guest is meeting (the salesperson), if anyone.
  staff_id uuid references staff (id),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'showed', 'no_show', 'canceled')),
  -- The kiosk visit that counted as the show, when it came from a check-in.
  visit_id uuid references guest_visits (id),
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_appointments_org_scheduled_idx on crm_appointments (organization_id, scheduled_at);
create index crm_appointments_contact_idx on crm_appointments (contact_id);
alter table crm_appointments enable row level security;
create policy "crm_appointments_select_crm"
  on crm_appointments for select to authenticated
  using (private.can_read_crm(organization_id));
create trigger crm_appointments_no_delete before delete on crm_appointments
  for each row execute function private.prevent_delete();

commit;
