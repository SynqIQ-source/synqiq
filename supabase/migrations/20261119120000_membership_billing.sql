-- Monthly membership billing (Adam, 2026-11-19); rules in lib/billing/renewals.ts.
-- Billing start: the sign-up day (default) or prorated with drafts on the 1st.
-- Declines retry 3, 6 and 10 days after the billing date; after the last one
-- the membership is frozen (no booking) and the member shows red. Cards
-- expiring within a month show yellow and get two emails, 15 days apart.

alter table member_billing_schedules add column if not exists billing_start text not null default 'signup';
alter table member_billing_schedules drop constraint if exists member_billing_schedules_billing_start_check;
alter table member_billing_schedules add constraint member_billing_schedules_billing_start_check
  check (billing_start in ('signup', 'prorated'));
-- current | past_due (a retry is pending) | frozen (every retry failed)
alter table member_billing_schedules add column if not exists billing_state text not null default 'current';
alter table member_billing_schedules drop constraint if exists member_billing_schedules_billing_state_check;
alter table member_billing_schedules add constraint member_billing_schedules_billing_state_check
  check (billing_state in ('current', 'past_due', 'frozen'));
alter table member_billing_schedules add column if not exists frozen_at timestamptz;
-- The saved card (brand, last 4, expiry only; Stripe holds the card).
alter table member_billing_schedules add column if not exists card_brand text;
alter table member_billing_schedules add column if not exists card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$');
alter table member_billing_schedules add column if not exists card_exp_month integer check (card_exp_month is null or card_exp_month between 1 and 12);
alter table member_billing_schedules add column if not exists card_exp_year integer check (card_exp_year is null or card_exp_year between 2000 and 2100);

-- One row per schedule per billing date: the unique key is what makes a
-- re-run unable to charge anyone twice for the same month.
create table if not exists membership_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  schedule_id uuid not null references member_billing_schedules (id) on delete cascade,
  mindbody_client_id text,
  due_date date not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  -- scheduled -> processing -> paid | declined (retry pending) -> ... | failed (frozen) | cancelled
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'declined', 'failed', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_on date,
  last_decline text,
  livemode boolean not null default false,
  stripe_account_id text,
  payment_intent_id text,
  sale_id uuid references pos_sales (id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, due_date)
);
create index if not exists membership_charges_due_idx on membership_charges (organization_id, status, next_attempt_on);
create index if not exists membership_charges_client_idx on membership_charges (organization_id, mindbody_client_id, due_date);

-- Expiring-card emails sent (first when the card turns yellow, second 15 days later).
create table if not exists card_expiry_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  schedule_id uuid not null references member_billing_schedules (id) on delete cascade,
  card_exp_month integer not null,
  card_exp_year integer not null,
  notice text not null check (notice in ('first', 'second')),
  sent_at timestamptz not null default now(),
  unique (schedule_id, card_exp_month, card_exp_year, notice)
);

alter table membership_charges enable row level security;
alter table card_expiry_notices enable row level security;

-- Club Admins only (like payment schedules); writes go through the server.
drop policy if exists membership_charges_select_admin on membership_charges;
create policy membership_charges_select_admin on membership_charges for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists card_expiry_notices_select_admin on card_expiry_notices;
create policy card_expiry_notices_select_admin on card_expiry_notices for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
