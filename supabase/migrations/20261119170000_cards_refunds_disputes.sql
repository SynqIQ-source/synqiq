-- Membership billing steps 3-5 (Adam, 2026-11-19).
--
-- Step 3, card on file: one saved card per member per Stripe mode, on the
-- studio's own Stripe account (Stripe holds the card; SynqIQ keeps brand,
-- last 4 and expiry). Staff update it at the desk, by an emailed link, or the
-- member does in the app. A new card is copied onto the member's payment
-- schedules and retries any declined payment.
create table if not exists member_cards (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  livemode boolean not null default false,
  stripe_account_id text not null,
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  card_brand text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_exp_month integer check (card_exp_month is null or card_exp_month between 1 and 12),
  card_exp_year integer check (card_exp_year is null or card_exp_year between 2000 and 2100),
  wallet text, -- apple_pay / google_pay / link when the card came from a wallet
  updated_via text not null check (updated_via in ('desk', 'link', 'app', 'pos')),
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, mindbody_client_id, livemode)
);

-- Emailed "update your card" links: only a hash of the token is stored.
create table if not exists card_update_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  token_hash text not null unique,
  reason text not null default 'staff' check (reason in ('staff', 'declined', 'expiring')),
  created_by_staff_id uuid references staff (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists card_update_links_client_idx on card_update_links (organization_id, mindbody_client_id);

-- Step 5: refunded renewals, and disputes (chargebacks) on studio payments.
alter table membership_charges drop constraint if exists membership_charges_status_check;
alter table membership_charges add constraint membership_charges_status_check
  check (status in ('scheduled', 'processing', 'paid', 'declined', 'failed', 'cancelled', 'refunded'));
alter table membership_charges add column if not exists refunded_at timestamptz;

create table if not exists payment_disputes (
  id text primary key, -- Stripe dispute id
  organization_id uuid not null references organizations (id) on delete cascade,
  stripe_account_id text not null,
  livemode boolean not null default false,
  payment_intent_id text,
  sale_id uuid references pos_sales (id) on delete set null,
  mindbody_client_id text,
  amount_cents integer not null,
  reason text,
  status text not null,
  evidence_due_by timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_disputes_org_idx on payment_disputes (organization_id, created_at desc);

alter table member_cards enable row level security;
alter table card_update_links enable row level security;
alter table payment_disputes enable row level security;

-- Read: Club Admins, Sales Leads and Sales (they update cards at the desk);
-- disputes and links: Club Admins. Writes go through the server.
drop policy if exists member_cards_select_sales_team on member_cards;
create policy member_cards_select_sales_team on member_cards for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_sees_members());
drop policy if exists payment_disputes_select_admin on payment_disputes;
create policy payment_disputes_select_admin on payment_disputes for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists card_update_links_select_admin on card_update_links;
create policy card_update_links_select_admin on card_update_links for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
