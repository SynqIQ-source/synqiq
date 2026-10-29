-- CRM messaging: one two-way thread per guest, mixing SMS (Twilio) and email
-- (Resend, via the follow-up relay domain).
begin;

-- The studio's Twilio number (E.164) that guests text. Inbound texts are
-- routed to the org by the number they were sent to.
alter table organizations add column crm_sms_number text unique;

-- Per-guest email alias on the relay domain (g-<token>@...), so a guest's
-- email reply lands back in their thread. Created on first email.
alter table crm_contacts add column email_alias text unique;
-- Carrier-level opt-out: set when the guest texts STOP, cleared on START.
alter table crm_contacts add column sms_opted_out_at timestamptz;
alter table crm_contacts add column last_message_at timestamptz;

create table crm_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  contact_id uuid not null references crm_contacts (id),
  channel text not null check (channel in ('sms', 'email')),
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null check (char_length(body) between 1 and 20000),
  subject text,
  -- Staff member who sent it (outbound only).
  sent_by_staff_id uuid references staff (id),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  -- Twilio message SID or Resend email id / RFC Message-ID.
  provider_message_id text,
  error text,
  -- Inbound messages: when a staff member first opened the thread.
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index crm_messages_contact_idx on crm_messages (contact_id, created_at);
create index crm_messages_unread_idx on crm_messages (organization_id, created_at desc)
  where direction = 'inbound' and read_at is null;
create index crm_messages_provider_idx on crm_messages (provider_message_id);
alter table crm_messages enable row level security;
create policy "crm_messages_select_crm"
  on crm_messages for select to authenticated
  using (private.can_read_crm(organization_id));
create trigger crm_messages_no_delete before delete on crm_messages
  for each row execute function private.prevent_delete();

-- Only delivery status, error and read state can change; the message
-- itself (who, what, when) is permanent.
create or replace function private.crm_messages_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     or new.subject is distinct from old.subject
     or new.channel is distinct from old.channel
     or new.direction is distinct from old.direction
     or new.contact_id is distinct from old.contact_id
     or new.organization_id is distinct from old.organization_id
     or new.sent_by_staff_id is distinct from old.sent_by_staff_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages cannot be changed';
  end if;
  return new;
end;
$$;
create trigger crm_messages_immutable before update on crm_messages
  for each row execute function private.crm_messages_immutable();

commit;
