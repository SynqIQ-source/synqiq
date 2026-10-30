-- Follow-up cadence for leads (lib/crm/follow-ups.ts).
--
-- The next follow-up is worked out from what already happened (created,
-- visits, outbound texts/emails/calls, appointments), so nothing here is a
-- task list. The only thing stored is a salesperson's reschedule: the date
-- they picked, and when they picked it. A text, email, call or visit after
-- that moment replaces it with the normal cadence again.

begin;

alter table crm_contacts
  add column follow_up_on date,
  add column follow_up_set_at timestamptz,
  add column follow_up_set_by_staff_id uuid references staff (id);

commit;
