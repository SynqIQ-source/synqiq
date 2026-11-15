-- Website form submissions held as spam (bot patterns) instead of becoming
-- leads. A Club Admin can review them and release a real one into the CRM.

create table if not exists crm_spam_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  lead_form_id uuid references crm_lead_forms (id) on delete set null,
  fingerprint text not null unique,
  first_name text,
  last_name text,
  email text,
  phone text,
  message text,
  lead jsonb not null, -- the parsed submission, to release it as a lead
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  released_at timestamptz,
  released_by_staff_id uuid references staff (id),
  released_contact_id uuid references crm_contacts (id) on delete set null
);
create index if not exists crm_spam_submissions_org_idx on crm_spam_submissions (organization_id, created_at desc);

alter table crm_spam_submissions enable row level security;
drop policy if exists "crm_spam_submissions_select_admin" on crm_spam_submissions;
create policy "crm_spam_submissions_select_admin" on crm_spam_submissions for select to authenticated
  using (organization_id = private.current_staff_org_id() and private.current_staff_role() = 'admin');
