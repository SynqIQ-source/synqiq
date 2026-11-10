-- Memberships in SynqIQ, step 1: the studio's membership plans (contract
-- templates) and every member's contract, imported from Mindbody
-- (lib/sync/member-contracts.ts). Mindbody keeps charging until the switch;
-- these tables are SynqIQ's copy and the basis for shadow billing.
-- Club Admins only (billing details).

create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_contract_id integer,               -- Mindbody contract template id (sale/contracts Id)
  name text not null,
  description text,
  recurring_subtotal_cents integer,           -- dues before tax per autopay
  first_payment_subtotal_cents integer,       -- incl. enrollment/registration fee
  autopay_frequency text,                     -- e.g. Monthly, Weekly
  number_of_autopays integer,                 -- term length in autopays
  after_term text,                            -- ContractAutomaticallyRenews / ContractExpires
  sold_online boolean not null default false,
  client_can_terminate_online boolean not null default false,
  requires_signature boolean not null default false,
  members_only boolean not null default false,
  active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, mindbody_contract_id)
);

create table if not exists member_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_contract_id bigint not null, -- the member's contract (ClientContract Id)
  mindbody_client_id text not null,            -- Mindbody client Id (matches clients.mindbody_client_id)
  payer_mindbody_client_id text,               -- set when someone else pays
  plan_id uuid references membership_plans (id) on delete set null,
  mindbody_contract_id integer,                -- template id
  contract_name text not null,
  agreement_date date,
  start_date date,
  end_date date,
  termination_date date,
  -- First contract in its renewal chain (12-month commitments renew
  -- themselves); used to find "members since" for price increases.
  original_start_date date,
  original_client_contract_id bigint,
  renewed_from_client_contract_id bigint,
  autopay_status text,                         -- Active / Suspended / ...
  auto_renewing boolean,
  is_month_to_month boolean,
  normal_autopay_cents integer,                -- usual dues subtotal
  next_bill_date date,
  next_bill_subtotal_cents integer,
  next_bill_tax_cents integer,
  next_bill_total_cents integer,
  upcoming_autopays jsonb not null default '[]'::jsonb, -- [{date, subtotalCents, taxCents, totalCents, productId}]
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, mindbody_client_contract_id)
);

create index if not exists member_contracts_client_idx on member_contracts (organization_id, mindbody_client_id);
create index if not exists member_contracts_next_bill_idx on member_contracts (organization_id, next_bill_date);
create index if not exists member_contracts_original_start_idx on member_contracts (organization_id, original_start_date);

-- When each member's contracts were last pulled (drives the rolling refresh).
create table if not exists member_contract_sync (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  synced_at timestamptz not null default now(),
  contract_count integer not null default 0,
  primary key (organization_id, mindbody_client_id)
);

alter table membership_plans enable row level security;
alter table member_contracts enable row level security;
alter table member_contract_sync enable row level security;

-- Club Admins of the studio can read; all writes go through server code.
create policy "membership_plans_select_club_admin" on membership_plans for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_contracts_select_club_admin" on member_contracts for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
-- member_contract_sync: service role only (no policies).
