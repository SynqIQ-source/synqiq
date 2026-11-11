-- Class pay when nobody came: Mindbody's "No Registrations Rate". When set, a
-- class with zero paid clients pays this instead of the formula. The
-- Preserve: the incentive base ($40), and $35 for Group Pilates.
alter table pay_rates add column if not exists no_registration_cents integer
  check (no_registration_cents is null or no_registration_cents >= 0);
