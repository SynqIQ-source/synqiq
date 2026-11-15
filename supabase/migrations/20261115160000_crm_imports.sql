-- Lead imports (Gym Sales first). Each import is a batch so it can be undone
-- in one step; each imported guest keeps the source system's id and the
-- extra fields SynqIQ has no column for (tags, not-interested reason,
-- waiver, original salesperson).

create table if not exists crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  source text not null check (source in ('gymsales')),
  filename text,
  summary jsonb not null default '{}'::jsonb,
  created_by_staff_id uuid references staff (id),
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_staff_id uuid references staff (id)
);

alter table crm_contacts add column if not exists import_batch_id uuid references crm_import_batches (id) on delete set null;
alter table crm_contacts add column if not exists external_ref text; -- 'gymsales:12345'
alter table crm_contacts add column if not exists import_data jsonb;
create index if not exists crm_contacts_external_ref_idx on crm_contacts (organization_id, external_ref);
create index if not exists crm_contacts_import_batch_idx on crm_contacts (import_batch_id);

alter table crm_import_batches enable row level security;
drop policy if exists "crm_import_batches_select_admin" on crm_import_batches;
create policy "crm_import_batches_select_admin" on crm_import_batches for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
