-- Member payments, part 1: each studio's own Stripe account (Stripe Connect,
-- Standard-style via Accounts v2 -- Stripe's recommendation 2026-11-11).
--
-- One connected account per studio. The studio is the merchant: it accepts
-- payments from its own members, gets its own payouts, uses the full Stripe
-- Dashboard, and Stripe collects its fees and losses from the studio. Member
-- charges are DIRECT charges created in the studio's account. The studio <->
-- account mapping lives only here and is enforced server-side; the browser
-- never chooses the account.

create table if not exists stripe_connected_accounts (
  organization_id uuid primary key references organizations (id) on delete cascade,
  stripe_account_id text not null unique,
  livemode boolean not null,
  card_payments_status text, -- active | pending | restricted | rejected | unsupported
  ready boolean not null default false, -- card payments active and nothing currently due
  requirements_due text[] not null default '{}',
  display_name text,
  onboarding_started_at timestamptz not null default now(),
  ready_at timestamptz,
  last_checked_at timestamptz,
  created_by_staff_id uuid references staff (id)
);

-- Connect webhook events already handled (signature-verified), so a repeated
-- or out-of-order delivery is never applied twice.
create table if not exists stripe_connect_events (
  id text primary key,
  type text not null,
  stripe_account_id text,
  received_at timestamptz not null default now()
);

alter table stripe_connected_accounts enable row level security;
alter table stripe_connect_events enable row level security;

drop policy if exists "stripe_connected_accounts_select_admin" on stripe_connected_accounts;
create policy "stripe_connected_accounts_select_admin" on stripe_connected_accounts for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
-- stripe_connect_events: service role only (no policies).
