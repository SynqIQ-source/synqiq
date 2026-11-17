-- Gym Sales activity history (calls with notes, texts both ways, emails)
-- imported from Gym Sales' report exports, matched to leads by name. Kept
-- apart from crm_messages, which is SynqIQ's own immutable record of what it
-- sent: these rows can be undone with their import batch. Read with the same
-- rules as crm_messages (CRM staff of the studio; a lead's assigned trainer).

alter table crm_import_batches drop constraint if exists crm_import_batches_source_check;
alter table crm_import_batches add constraint crm_import_batches_source_check check (source in ('gymsales', 'gymsales_activity'));

create table if not exists crm_imported_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contact_id uuid not null references crm_contacts(id) on delete cascade,
  import_batch_id uuid not null references crm_import_batches(id) on delete cascade,
  kind text not null check (kind in ('call', 'sms', 'email')),
  direction text not null check (direction in ('outbound', 'inbound')),
  occurred_at timestamptz not null,
  outcome text,
  body text,
  subject text,
  sent_by_name text,
  next_action text,
  person_name text not null,
  source_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, source_key)
);
create index if not exists crm_imported_activity_contact_idx on crm_imported_activity (contact_id, occurred_at);
create index if not exists crm_imported_activity_batch_idx on crm_imported_activity (import_batch_id);

-- Latest imported activity per lead (set by the import), so follow-up lists
-- include imported leads that were being worked.
alter table crm_contacts add column if not exists imported_activity_at timestamptz;

alter table crm_imported_activity enable row level security;
drop policy if exists "crm_imported_activity_select_crm" on crm_imported_activity;
create policy "crm_imported_activity_select_crm" on crm_imported_activity for select to authenticated
  using (private.can_read_crm(organization_id));
drop policy if exists "crm_imported_activity_select_assigned_trainer" on crm_imported_activity;
create policy "crm_imported_activity_select_assigned_trainer" on crm_imported_activity for select to authenticated
  using (private.is_assigned_trainer(contact_id));
