-- ============================================================================
-- Manual-import pipeline for Mindbody dashboard-only reports (no API
-- endpoint exists for any of these -- confirmed empirically, see
-- conversation history). report_imports is the shared audit/batch table
-- across all report types; instructor_reviews is the first fact table,
-- built against the confirmed "Ratings and Reviews" dashboard report
-- columns. revenue_line_items / payroll_line_items are schema-only stubs:
-- no ImportDefinition references them yet, and their exact shape (payroll
-- especially) still needs the same live-dashboard column verification pass
-- reviews already got.
--
-- staff_id on instructor_reviews is NOT NULL by design, not a soft/nullable
-- resolution -- an uploaded row whose Staff name doesn't exact-match (case-
-- insensitively) exactly one staff.display_name in the org fails validation
-- and, under the all-or-nothing import contract, blocks the whole file
-- rather than landing with a null FK. A rejected unmatched name is safer
-- than a silently misattributed review.
-- ============================================================================

begin;

-- === report_imports: shared batch/audit table for all report types ============
create table report_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  report_type text not null check (report_type in ('ratings_reviews', 'revenue', 'payroll')),
  uploaded_by_staff_id uuid not null references staff (id),
  filename text not null,
  storage_path text not null,
  row_count integer not null,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null check (status in ('success', 'failed')),
  error_summary jsonb,
  created_at timestamptz not null default now()
);

alter table report_imports enable row level security;

create policy "report_imports_select_same_org"
  on report_imports for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create policy "report_imports_insert_admin_own_org"
  on report_imports for insert
  to authenticated
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

create policy "report_imports_update_admin_own_org"
  on report_imports for update
  to authenticated
  using (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  )
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

-- === instructor_reviews =========================================================
create table instructor_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  import_batch_id uuid not null references report_imports (id),
  row_hash text not null,
  date_of_service date not null,
  staff_id uuid not null references staff (id),
  staff_name_raw text not null,
  client_name text not null,
  service_name text,
  rating smallint not null check (rating between 1 and 5),
  review_text text,
  helpful_count integer not null default 0,
  not_helpful_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (organization_id, row_hash)
);

alter table instructor_reviews enable row level security;

create policy "instructor_reviews_select_same_org"
  on instructor_reviews for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create policy "instructor_reviews_insert_admin_own_org"
  on instructor_reviews for insert
  to authenticated
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

-- === revenue_line_items / payroll_line_items: schema-only stubs ===============
create table revenue_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  import_batch_id uuid not null references report_imports (id),
  row_hash text not null,
  date_of_service date not null,
  staff_id uuid references staff (id),
  staff_name_raw text not null,
  client_name text not null,
  class_name text,
  service_category text not null,
  department_id uuid references departments (id),
  pricing_option text,
  revenue_amount numeric not null,
  created_at timestamptz not null default now(),
  unique (organization_id, row_hash)
);

alter table revenue_line_items enable row level security;

create policy "revenue_line_items_select_same_org"
  on revenue_line_items for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create policy "revenue_line_items_insert_admin_own_org"
  on revenue_line_items for insert
  to authenticated
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

-- payroll_line_items intentionally has no real columns yet beyond the
-- shared audit scaffolding -- shape TBD after the live-dashboard payroll
-- column verification pass. No ImportDefinition references this table.
create table payroll_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  import_batch_id uuid not null references report_imports (id),
  row_hash text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, row_hash)
);

alter table payroll_line_items enable row level security;

create policy "payroll_line_items_select_same_org"
  on payroll_line_items for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create policy "payroll_line_items_insert_admin_own_org"
  on payroll_line_items for insert
  to authenticated
  with check (
    organization_id = private.current_staff_org_id()
    and private.current_staff_role() = 'admin'
  );

-- === report-imports storage bucket: private, admin-only, own-org ==============
insert into storage.buckets (id, name, public)
values ('report-imports', 'report-imports', false)
on conflict (id) do nothing;

create policy "report_imports_bucket_admin_own_org"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'report-imports'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  )
  with check (
    bucket_id = 'report-imports'
    and private.current_staff_role() = 'admin'
    and (storage.foldername(name))[1] = private.current_staff_org_id()::text
  );

commit;
