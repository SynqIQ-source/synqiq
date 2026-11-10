-- Mindbody's AutoPay Detail report, uploaded by a Club Admin on
-- Settings -> Imports: what Mindbody charged / will charge each member on
-- each date. The answer key that shadow billing compares SynqIQ against.
-- Re-uploading updates rows (a "Scheduled" charge later becomes "Success"
-- or "Declined"). Only the card's brand, last 4 and expiry are kept.

alter table report_imports drop constraint if exists report_imports_report_type_check;
alter table report_imports add constraint report_imports_report_type_check
  check (report_type in ('ratings_reviews', 'revenue', 'payroll', 'mbo_autopay'));

create table if not exists mbo_autopay_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  import_batch_id uuid references report_imports (id) on delete set null,
  row_hash text not null,
  charge_date date not null,
  client_name text not null,
  client_email text,
  mindbody_client_id text,           -- matched by email, else by unique name; null when not found
  match_method text check (match_method in ('email', 'name')),
  location text,
  item text not null,
  contract_associated boolean,
  card_brand text,
  card_last4 text,
  card_exp_month smallint,
  card_exp_year smallint,
  amount_cents integer not null,     -- total including tax, as in the report
  status text not null check (status in ('success', 'scheduled', 'suspended', 'declined', 'other')),
  status_detail text,                -- the report's text, e.g. decline reason
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, row_hash)
);

create index if not exists mbo_autopay_rows_date_idx on mbo_autopay_rows (organization_id, charge_date);
create index if not exists mbo_autopay_rows_client_idx on mbo_autopay_rows (organization_id, mindbody_client_id);

alter table mbo_autopay_rows enable row level security;

create policy "mbo_autopay_rows_select_club_admin" on mbo_autopay_rows for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "mbo_autopay_rows_insert_club_admin" on mbo_autopay_rows for insert to authenticated
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
create policy "mbo_autopay_rows_update_club_admin" on mbo_autopay_rows for update to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin')
  with check (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
