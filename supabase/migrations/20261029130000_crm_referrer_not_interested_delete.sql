-- CRM: referring member added after check-in (timestamped), "not interested"
-- status, and admin delete (a hide, since waivers are kept indefinitely).
begin;

-- Who linked or typed the referring member after the fact, and when. Null
-- when it came from the kiosk at check-in.
alter table crm_contacts add column referrer_set_at timestamptz;
alter table crm_contacts add column referrer_set_by_staff_id uuid references staff (id);

-- Not interested: a status, plus when it was set (the reason, if any, is
-- saved as a note).
alter table crm_contacts drop constraint crm_contacts_status_check;
alter table crm_contacts add constraint crm_contacts_status_check
  check (status in ('guest', 'lead', 'member', 'not_interested'));
alter table crm_contacts add column not_interested_at timestamptz;

-- Admin "delete": the contact is hidden from every list, match and lookup.
-- Rows are never removed (the no-delete trigger stays): a guest's signed
-- waivers must be kept, and they reference the contact.
alter table crm_contacts add column deleted_at timestamptz;
alter table crm_contacts add column deleted_by_staff_id uuid references staff (id);
create index crm_contacts_org_live_idx on crm_contacts (organization_id) where deleted_at is null and merged_into_id is null;

commit;
