-- Per-instructor opt-out from the every-4-days substitution-request
-- reminder email (not the immediate day-1 "open request" email, which
-- always sends -- see lib/substitutions/reminders.ts). Defaults to false
-- (opted in) so existing staff keep getting reminders until they
-- explicitly turn them off.
begin;

alter table staff
  add column substitution_reminder_opt_out boolean not null default false;

comment on column staff.substitution_reminder_opt_out is
  'Self-service opt-out from the every-4-days "still open" substitution reminder email. Does not affect the immediate email sent when a request is first created. Set via /api/staff/me/substitution-reminders, same admin-client self-edit pattern as display_name/title in /api/staff/me/profile -- staff has no RLS UPDATE policy at all.';

commit;
