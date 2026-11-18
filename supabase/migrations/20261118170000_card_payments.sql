-- Member payments, part 2: card payments at checkout (direct charges in the
-- studio's own Stripe account, per Stripe's recommendation 2026-11-11).
--
-- 1. A studio can have a test-mode AND a live-mode connected account, so
--    testing never blocks (or is mistaken for) the real one. Code only uses
--    the row whose mode matches the server's Stripe key.
-- 2. pos_card_payments: one row per card payment attempt. The sale is NOT
--    written until Stripe confirms the payment (checked on the server, and
--    again by the Connect payments webhook if the browser goes away), so an
--    unpaid cart never shows up in sales or reports.

alter table stripe_connected_accounts drop constraint if exists stripe_connected_accounts_pkey;
alter table stripe_connected_accounts add primary key (organization_id, livemode);

create table if not exists pos_card_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  staff_id uuid not null references staff (id),
  stripe_account_id text not null,
  livemode boolean not null,
  payment_intent_id text unique,
  stripe_customer_id text,
  stripe_payment_method_id text,
  amount_cents integer not null check (amount_cents > 0),
  application_fee_cents integer not null default 0,
  -- pending -> finalizing -> completed; or failed / needs_attention
  status text not null default 'pending'
    check (status in ('pending', 'finalizing', 'completed', 'cancelled', 'needs_attention')),
  sale_request jsonb not null, -- the validated checkout (lines, buyer, signatures)
  sale_id uuid references pos_sales (id) on delete set null,
  last_error text,
  refunded_cents integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists pos_card_payments_org_idx on pos_card_payments (organization_id, created_at desc);
create index if not exists pos_card_payments_sale_idx on pos_card_payments (sale_id);

alter table pos_card_payments enable row level security;
-- service role only (no policies): holds signatures and Stripe ids.

-- The saved card for renewals (membership packages), for the renewal
-- scheduler: a customer and payment method in the studio's account.
alter table member_billing_schedules add column if not exists stripe_account_id text;
alter table member_billing_schedules add column if not exists stripe_customer_id text;
alter table member_billing_schedules add column if not exists stripe_payment_method_id text;
