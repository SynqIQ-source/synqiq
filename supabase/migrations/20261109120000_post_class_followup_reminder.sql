-- When the "follow up with your class" reminder went out for this class
-- (lib/followup/post-class-reminders.ts). Set before sending so overlapping
-- cron runs can't remind twice. SynqIQ-owned: the Mindbody class sync never
-- sends this column, so a re-sync leaves it alone.
alter table class_occurrences
  add column if not exists followup_reminder_sent_at timestamptz;

-- The reminder job scans recently ended classes not yet reminded.
create index if not exists class_occurrences_followup_reminder_due_idx
  on class_occurrences (end_datetime)
  where followup_reminder_sent_at is null;
