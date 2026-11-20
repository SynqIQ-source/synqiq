-- Jan 1 cutover from Mindbody autopays to SynqIQ billing (Adam, 2026-11-19).
-- A saved copy (snapshot) of every Mindbody autopay contract, planned as a
-- SynqIQ schedule on the member's own billing day. Locked before Adam
-- terminates the contracts in Mindbody, so the terminations synced back
-- don't erase it. Schedules are created only when Adam activates, and only
-- for payers with a card in Stripe.
create table if not exists billing_cutover_settings (
  organization_id uuid primary key references organizations (id) on delete cascade,
  cutover_date date not null default '2027-01-01',
  snapshot_at timestamptz,
  snapshot_by_staff_id uuid references staff (id),
  locked_at timestamptz,
  locked_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now()
);

create table if not exists billing_cutover_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_contract_id bigint not null,
  member_mindbody_client_id text not null, -- whose membership it is
  payer_mindbody_client_id text not null, -- who pays (often a family member)
  member_name text,
  payer_name text,
  contract_name text not null,
  autopay_status text,
  first_bill_date date,
  bill_day integer,
  subtotal_cents integer,
  tax_cents integer,
  total_cents integer,
  remaining_payments integer,
  auto_renews boolean not null default false,
  basis text,
  contract_end_date date,
  status text not null default 'planned' check (status in ('planned', 'excluded', 'activated')),
  excluded_reason text,
  excluded_by_staff boolean not null default false,
  schedule_id uuid references member_billing_schedules (id) on delete set null,
  captured_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (organization_id, mindbody_client_contract_id)
);
create index if not exists billing_cutover_rows_payer_idx on billing_cutover_rows (organization_id, payer_mindbody_client_id);

alter table billing_cutover_settings enable row level security;
alter table billing_cutover_rows enable row level security;
drop policy if exists billing_cutover_settings_select_admin on billing_cutover_settings;
create policy billing_cutover_settings_select_admin on billing_cutover_settings for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
drop policy if exists billing_cutover_rows_select_admin on billing_cutover_rows;
create policy billing_cutover_rows_select_admin on billing_cutover_rows for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');

-- The "add your card" email for the move (Email > Templates).
alter table email_templates drop constraint if exists email_templates_key_check;
alter table email_templates add constraint email_templates_key_check check (
  key in (
    'payment_declined',
    'payment_on_hold',
    'card_expiring',
    'card_expiring_reminder',
    'card_link',
    'card_cutover',
    'rating_request',
    'class_followup_reminder'
  )
);

-- When each payer was last emailed an add-your-card link for the move.
alter table billing_cutover_rows add column if not exists card_link_sent_at timestamptz;
