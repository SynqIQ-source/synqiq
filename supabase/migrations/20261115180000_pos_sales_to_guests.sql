-- The POS can sell to a CRM guest or lead who isn't a Mindbody client yet
-- (a guest buying their first membership). The sale and its payment
-- schedule point at the guest; nothing goes to Mindbody.

alter table pos_sales add column if not exists crm_contact_id uuid references crm_contacts (id) on delete set null;
create index if not exists pos_sales_crm_contact_idx on pos_sales (crm_contact_id) where crm_contact_id is not null;

alter table member_billing_schedules alter column mindbody_client_id drop not null;
alter table member_billing_schedules add column if not exists crm_contact_id uuid references crm_contacts (id) on delete set null;
alter table member_billing_schedules drop constraint if exists member_billing_schedules_who_check;
alter table member_billing_schedules add constraint member_billing_schedules_who_check
  check (mindbody_client_id is not null or crm_contact_id is not null);
