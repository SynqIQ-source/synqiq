-- Monthly sales targets (KPIs) for the Sales dashboard and Sales History.
-- One row per org, month, scope (staff_id null = the whole club, else one
-- salesperson) and metric. Admins edit them on Settings → Sales Targets
-- (writes go through an admin-only API route with the service role); CRM
-- staff can read them.
begin;

create table crm_kpi_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  -- First day of the month the targets are for.
  month date not null check (extract(day from month) = 1),
  staff_id uuid references staff (id),
  -- A key from lib/crm/kpis.ts (validated by the API).
  metric text not null check (metric ~ '^[a-z_]{1,40}$'),
  target numeric(10, 2) not null check (target >= 0 and target <= 1000000),
  updated_by_staff_id uuid references staff (id),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, month, staff_id, metric)
);
create index crm_kpi_targets_org_month_idx on crm_kpi_targets (organization_id, month);

alter table crm_kpi_targets enable row level security;
create policy "crm_kpi_targets_select_crm"
  on crm_kpi_targets for select to authenticated
  using (private.can_read_crm(organization_id));

commit;
