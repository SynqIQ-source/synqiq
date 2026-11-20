-- Mindbody off-ramp (Adam, 2026-11-19): one switch per studio that stops
-- every Mindbody call and sync for it (after Jan 23, when API access ends).
-- Null = connected. The data already copied into SynqIQ stays.
alter table organizations add column if not exists mindbody_disconnected_at timestamptz;
alter table organizations add column if not exists mindbody_disconnected_by_staff_id uuid references staff (id);
