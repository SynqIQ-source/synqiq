-- Substitution-request email reminders (every 4 days while a request stays
-- 'open') need to know when the last reminder went out, distinct from
-- created_at -- otherwise there's no way to tell "just created" from
-- "reminded 3 days ago" when deciding whether today's check should fire
-- again. NULL means never reminded yet (the day-1 immediate email doesn't
-- count -- that's sent inline at creation, not through this column).
begin;

alter table substitution_requests
  add column last_reminder_sent_at timestamptz;

comment on column substitution_requests.last_reminder_sent_at is
  'When the last every-4-days reminder email went out for this request. NULL means never (the immediate day-1 email at creation is separate and does not set this). Reminder job compares now() against GREATEST(created_at, last_reminder_sent_at) + 4 days.';

commit;
