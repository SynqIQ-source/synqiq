-- New members vs PT, and PT revenue for Trainer Health
-- (lib/mindbody/item-types.ts, lib/crm/onboarding.ts, lib/sync/sales.ts).
--
-- Mindbody can't tell us reliably which contracts are memberships or which
-- items sold are PT (it won't return the program of a pricing option that
-- isn't sold online), so each studio has a list of the contract and item
-- names Synq has seen, each counted or not by a best guess from its name
-- that an admin can override on Settings -> Mindbody items.

begin;

create table mindbody_item_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- contract: "counts as a membership"; sale_item: "is PT".
  kind text not null check (kind in ('contract', 'sale_item')),
  name text not null check (char_length(name) between 1 and 200),
  -- An admin's choice; null means use the guess from the name.
  counts boolean,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_by_staff_id uuid references staff (id),
  unique (organization_id, kind, name)
);
alter table mindbody_item_types enable row level security;
create policy "mindbody_item_types_select_same_org"
  on mindbody_item_types for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- What each Mindbody sale was made of (the sales table keeps only totals).
create table sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  mindbody_sale_id bigint not null,
  line_number integer not null,
  pricing_option_id bigint,
  description text,
  total_amount numeric,
  -- The client contract this line paid for, when it's a contract item.
  client_contract_id bigint,
  unique (organization_id, mindbody_sale_id, line_number)
);
create index sale_items_org_sale_idx on sale_items (organization_id, mindbody_sale_id);
alter table sale_items enable row level security;
create policy "sale_items_select_same_org"
  on sale_items for select to authenticated
  using (organization_id = private.current_staff_org_id());

-- New-member onboarding: whether the membership that made someone Active
-- counts, and why not when it doesn't.
alter table crm_contacts drop constraint crm_contacts_enrollment_status_check;
alter table crm_contacts add constraint crm_contacts_enrollment_status_check
  check (enrollment_status in ('pending', 'found', 'no_contract', 'not_counted'));
alter table crm_contacts
  -- new: never had a membership; returning: last one ended over 90 days before.
  add column enrollment_kind text check (enrollment_kind in ('new', 'returning')),
  -- not_counted: not_membership (e.g. PT), renewal, or continuation (re-signed within 90 days).
  add column enrollment_note text;

commit;
