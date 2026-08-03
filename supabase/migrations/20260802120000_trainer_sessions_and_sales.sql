-- Trainer-health tracking: "sessions serviced" (Appointments) and "sales
-- credited" (Sales, via SalesRepId) per trainer, plus the org-configurable
-- flat-rate benchmark used to compute a health ratio at query time (same
-- "always compute true sum at query time, never pre-aggregate/store"
-- convention as Overview/Heat Map/Instructor Performance -- no ratio or
-- monthly rollup column exists here, only the raw synced rows).
--
-- Both new tables mirror class_occurrences' existing shape/conventions:
-- a mindbody_*_id unique column as the upsert conflict target, a real
-- organization_id column (not the departments/rooms NULL-org compromise --
-- MindBody's Appointment and Sale payloads both carry enough to resolve org
-- directly, same as class_occurrences does), and the same
-- "*_select_same_org" RLS policy already used for every other org-scoped
-- table. No update/insert/delete policy for authenticated users on either
-- table -- both are sync-only, written exclusively by the admin-client sync
-- routes, same as class_occurrences before its one admin-update policy was
-- added for the substitute-approval flow (neither of these tables has an
-- equivalent user-facing mutation).
begin;

-- === organizations.expected_revenue_per_session ==============================
-- Flat per-session benchmark used to compute each trainer's health ratio
-- (actual sales credited / (sessions serviced * this rate)). $100 default
-- matches the existing spreadsheet figure the studio already uses. A plain
-- editable org setting (Settings page), not a constant, so it can be
-- adjusted periodically without a code change/deploy.
alter table organizations
  add column expected_revenue_per_session numeric not null default 100
    check (expected_revenue_per_session > 0);

-- === appointment_occurrences ===================================================
-- One row per MindBody Appointment (GET /appointment/staffappointments).
-- Status has exactly 5 real values confirmed against the sandbox: Booked,
-- Confirmed, Arrived, Completed, NoShow -- "sessions serviced" reads as
-- status = 'Completed' at query time, not filtered here at sync time, so a
-- future page can still show/count non-Completed appointments if needed.
create table appointment_occurrences (
  id uuid primary key default gen_random_uuid(),
  mindbody_appointment_id bigint not null unique,
  organization_id uuid not null references organizations(id),
  staff_id uuid references staff(id),
  location_id uuid references "Locations"(id),
  -- MindBody's ClientId, kept as raw text -- this app has no local clients
  -- table (same as every other MindBody id this codebase doesn't have a
  -- local table for), so this is provenance, not a join target.
  client_id text,
  session_type_id integer,
  status text not null check (status in ('Booked', 'Confirmed', 'Arrived', 'Completed', 'NoShow')),
  start_datetime timestamptz not null,
  end_datetime timestamptz,
  duration_minutes integer,
  created_at timestamptz not null default now()
);

create index appointment_occurrences_org_staff_start_idx
  on appointment_occurrences (organization_id, staff_id, start_datetime);

alter table appointment_occurrences enable row level security;

create policy "appointment_occurrences_select_same_org"
  on appointment_occurrences for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- === sales ======================================================================
-- One row per MindBody Sale (GET /sale/sales). total_amount is the sum of
-- that sale's PurchasedItems[].TotalAmount -- SalesRepId (confirmed ~7.75%
-- populated in the sandbox) is sale-level only, never per-line-item, so
-- this table doesn't need a sale_line_items child table for what this
-- feature tracks ("everything a rep is credited with as sales rep," not a
-- line-item breakdown). sales_rep_staff_id stays null for the (majority, in
-- the sandbox) of sales with no SalesRepId set -- those are real
-- unattributed sales, not a sync gap, and must not be silently attributed
-- to anyone.
create table sales (
  id uuid primary key default gen_random_uuid(),
  mindbody_sale_id bigint not null unique,
  organization_id uuid not null references organizations(id),
  sales_rep_staff_id uuid references staff(id),
  client_id text,
  sale_datetime timestamptz not null,
  total_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index sales_org_rep_datetime_idx
  on sales (organization_id, sales_rep_staff_id, sale_datetime);

alter table sales enable row level security;

create policy "sales_select_same_org"
  on sales for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

commit;
