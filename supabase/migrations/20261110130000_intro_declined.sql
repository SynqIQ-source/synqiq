-- A new member who said no to the intro workout. Set by their trainer or a
-- club admin (app/api/crm/contacts/[id]/intro); shows as "Declined intro"
-- on New Members, Follow Up and the profile, and takes them out of the
-- "awaiting outreach" counts. A later real intro booking still wins.
alter table crm_contacts
  add column if not exists intro_declined_at timestamptz,
  add column if not exists intro_declined_by_staff_id uuid references staff (id),
  add column if not exists intro_declined_reason text;
