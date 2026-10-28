-- CRM: guest notes, and the per-org switch for sending guests to Mindbody.
begin;

-- === Mindbody push switch ===================================================
-- Per-org (requirement 13): new CRM contacts are sent to Mindbody as clients
-- (linked to an existing client on an email/phone match, else created).
alter table organizations add column crm_mindbody_push boolean not null default false;
comment on column organizations.crm_mindbody_push is
  'CRM: send new guests/leads to Mindbody after the email check (link on email/phone match, else AddClient).';
update organizations set crm_mindbody_push = true where mindbody_site_id = 561843;

alter table crm_contacts add column mindbody_synced_at timestamptz;
-- Why the last push didn't go through (e.g. fields Mindbody requires), for
-- staff. Never contains anything beyond field names and Mindbody's status.
alter table crm_contacts add column mindbody_sync_error text;

-- === notes ==================================================================
-- Staff notes on a guest. Kept like the rest of the CRM record: no edits,
-- no deletes; a correction is a new note.
create table crm_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  contact_id uuid not null references crm_contacts (id),
  author_staff_id uuid not null references staff (id),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index crm_notes_contact_idx on crm_notes (contact_id, created_at desc);
alter table crm_notes enable row level security;
create policy "crm_notes_select_crm"
  on crm_notes for select to authenticated
  using (private.can_read_crm(organization_id));
create trigger crm_notes_no_delete before delete on crm_notes
  for each row execute function private.prevent_delete();

create or replace function private.crm_notes_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Notes cannot be changed; add a new note instead';
end;
$$;
create trigger crm_notes_immutable before update on crm_notes
  for each row execute function private.crm_notes_immutable();

commit;
