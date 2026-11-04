-- Website lead forms: a studio's own website (Craft Freeform, WordPress,
-- Zapier, ...) posts each form submission to
--   https://synqiq.co/api/crm/web-leads/<token>
-- and it lands in the CRM as a web lead. The token is the only credential,
-- so only its SHA-256 hash is stored; the plain URL is shown to the admin
-- once, when the form is created or its URL is regenerated.

create table crm_lead_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  name text not null check (char_length(name) between 1 and 80),
  token_hash text unique,
  -- Optional "how did you hear" label stamped on new leads from this form.
  how_heard_label text check (how_heard_label is null or char_length(how_heard_label) between 1 and 60),
  -- Optional salesperson new leads from this form are assigned to.
  assigned_staff_id uuid references staff (id),
  revoked_at timestamptz,
  last_received_at timestamptz,
  submission_count integer not null default 0,
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now()
);

create index crm_lead_forms_org_idx on crm_lead_forms (organization_id);

alter table crm_lead_forms enable row level security;
create policy "crm_lead_forms_select_admin"
  on crm_lead_forms for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

alter table crm_contacts add column created_by_lead_form_id uuid references crm_lead_forms (id);

-- The visitor's message (and any extra form fields) is kept in the guest's
-- thread as an inbound "web" message, so it shows as unread like a text.
alter table crm_messages drop constraint crm_messages_channel_check;
alter table crm_messages add constraint crm_messages_channel_check
  check (channel in ('sms', 'email', 'call', 'web'));
