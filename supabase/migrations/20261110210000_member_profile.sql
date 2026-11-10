-- A member's profile history from Mindbody: visits (gym arrivals, classes,
-- appointments; past and booked), purchases (sales with their line items
-- and payments, for receipts) and services (packs and passes with sessions
-- used/remaining), plus contact details. Filled per member from Mindbody's client endpoints
-- (lib/sync/member-profile.ts): on demand from the member's page for now, a
-- one-time full pull closer to the switch, then nightly. Read-only against
-- Mindbody. Club Admins only; written by the service role.

create table if not exists member_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_visit_id bigint not null,
  mindbody_client_id text not null,
  kind text not null check (kind in ('arrival', 'class', 'appointment', 'other')),
  name text not null,
  start_local timestamp not null, -- studio-local time, as Mindbody gives it
  end_local timestamp,
  service_name text,          -- the pricing option the visit used
  staff_mindbody_id bigint,
  location_id integer,
  class_id bigint,
  appointment_id bigint,
  appointment_status text,
  signed_in boolean,
  late_cancelled boolean,
  missed boolean,
  web_signup boolean,
  last_modified_at timestamp,
  synced_at timestamptz not null default now(),
  unique (organization_id, mindbody_visit_id)
);
create index if not exists member_visits_client_idx on member_visits (organization_id, mindbody_client_id, start_local desc);

create table if not exists member_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_sale_id bigint not null,
  mindbody_client_id text not null, -- who bought
  sale_at timestamptz,
  location_id integer,
  sales_rep_mindbody_id bigint,
  total_cents integer not null default 0, -- sum of line totals (incl. tax)
  payments jsonb not null default '[]'::jsonb, -- [{method, type, amountCents}]
  synced_at timestamptz not null default now(),
  unique (organization_id, mindbody_sale_id)
);
create index if not exists member_sales_client_idx on member_sales (organization_id, mindbody_client_id, sale_at desc);

create table if not exists member_sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_sale_id bigint not null,
  mindbody_sale_detail_id bigint not null,
  description text not null,
  is_service boolean,
  product_id bigint,
  contract_id bigint,
  quantity numeric(10, 2),
  unit_price_cents integer,
  discount_cents integer,
  tax_cents integer,
  total_cents integer,
  returned boolean not null default false,
  recipient_unique_id bigint,
  unique (organization_id, mindbody_sale_detail_id)
);
create index if not exists member_sale_items_sale_idx on member_sale_items (organization_id, mindbody_sale_id);

create table if not exists member_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_service_id bigint not null,
  mindbody_client_id text not null,
  product_id bigint,
  name text not null,
  program text,
  count integer,      -- sessions bought (very large = unlimited)
  remaining integer,
  is_current boolean,
  active_date date,
  expiration_date date,
  payment_date date,
  returned boolean,
  synced_at timestamptz not null default now(),
  unique (organization_id, mindbody_client_service_id)
);
create index if not exists member_services_client_idx on member_services (organization_id, mindbody_client_id);

create table if not exists member_profile_sync (
  organization_id uuid not null references organizations (id) on delete cascade,
  mindbody_client_id text not null,
  synced_at timestamptz not null default now(),
  visits_from date not null,
  visit_count integer not null default 0,
  sale_count integer not null default 0,
  service_count integer not null default 0,
  -- Contact details from Mindbody's client record (Mindbody owns them until
  -- the switch): {email, mobilePhone, homePhone, addressLine1, addressLine2,
  -- city, state, postalCode, birthDate, photoUrl, emergencyContactName,
  -- emergencyContactPhone}
  personal jsonb not null default '{}'::jsonb,
  primary key (organization_id, mindbody_client_id)
);

alter table member_visits enable row level security;
alter table member_sales enable row level security;
alter table member_sale_items enable row level security;
alter table member_services enable row level security;
alter table member_profile_sync enable row level security;

create policy "member_visits_select_club_admin" on member_visits for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_sales_select_club_admin" on member_sales for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_sale_items_select_club_admin" on member_sale_items for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_services_select_club_admin" on member_services for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "member_profile_sync_select_club_admin" on member_profile_sync for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
