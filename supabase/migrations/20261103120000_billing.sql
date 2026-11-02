-- Self-serve signup and Stripe billing (lib/billing/*).
--
-- A studio signs up on /signup: its details wait in studio_signups while
-- the owner pays on Stripe Checkout, and the studio is created once Stripe
-- confirms (the success page and the webhook both try; whichever is first
-- wins). Each studio then carries its Stripe customer and subscription.
-- Texting over the allowance is added to the next invoice once a month,
-- recorded in billing_overage_charges so a month is never charged twice.
-- Only the service role reads or writes these (no RLS policies).

begin;

alter table organizations
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text unique,
  -- Mirrors the Stripe subscription: active, trialing, past_due, canceled...
  -- null for studios billed by hand (The Preserve).
  add column billing_status text;

create table studio_signups (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'provisioning', 'provisioned', 'failed')),
  checkout_session_id text unique,
  name text not null,
  timezone text not null,
  mindbody_site_id integer,
  modules text[] not null,
  owner_first_name text not null,
  owner_last_name text not null,
  owner_email text not null,
  terms_accepted_at timestamptz not null,
  organization_id uuid references organizations (id),
  error text,
  created_at timestamptz not null default now(),
  provisioned_at timestamptz
);
alter table studio_signups enable row level security;

create table billing_overage_charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- First day of the month the texts were sent in.
  month date not null,
  texts_sent integer not null,
  texts_over integer not null,
  amount_cents integer not null,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, month)
);
alter table billing_overage_charges enable row level security;

commit;
