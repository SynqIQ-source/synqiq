-- Client Engagement columns on Overview's By Department table need real
-- per-client attendance data, which nothing in this schema captures today
-- -- class_occurrences only has aggregate counts (total_signed_in/
-- total_booked), and there's no client roster at all. Both tables synced
-- from MindBody's Public API v6: clients from GET /client/clients
-- (paginated roster pull), class_visits from GET /class/classvisits
-- (per-occurrence attendance, one call per class instance).
--
-- Unique constraints are scoped by (organization_id, mindbody_*) from the
-- start, not the raw MindBody id alone -- see
-- 20260810120000_org_scope_reference_data_upserts.sql for why: MindBody
-- assigns these ids independently per account, and a bare-id unique
-- constraint already caused one real cross-org data collision in this
-- app (sandbox rows silently reassigned to a different org's sync).
begin;

-- === clients ==================================================================
-- mindbody_unique_id, not the visit-record's ClientId -- confirmed
-- empirically against a real class's visits that the two are NOT
-- interchangeable (a check-in method other than staff lookup, e.g. a
-- membership barcode scan, produces a ClientId that doesn't match this
-- client's actual UniqueId at all, while UniqueId/ClientUniqueId is
-- consistent everywhere). class_visits.client_mindbody_unique_id below is
-- the only reliable join key back to this table.
create table clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  mindbody_unique_id integer not null,
  first_name text not null,
  last_name text not null,
  -- Real values observed: Active, Non-Member, Expired, Terminated,
  -- Suspended, Declined. "Active" is the only one that means "a real
  -- current paying member" -- Non-Member dominates the roster (mostly
  -- prospects/leads that never converted). The separate `Active` boolean
  -- field MindBody also returns is NOT useful for this -- confirmed true
  -- on every sampled client regardless of membership status, so it's not
  -- stored here at all.
  status text not null,
  is_prospect boolean not null,
  creation_date timestamptz,
  synced_at timestamptz not null default now(),
  unique (organization_id, mindbody_unique_id)
);

alter table clients enable row level security;

create policy "clients_select_same_org"
  on clients for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

-- Total Members (Participation's denominator) is a simple count of
-- status = 'Active' rows for the org -- this index makes that count and
-- the roster upsert both fast without needing a dedicated column.
create index clients_org_status_idx on clients (organization_id, status);

-- === class_visits ==============================================================
-- One row per (occurrence, client) -- a client's single booking/attendance
-- record for that specific class instance. Department attribution goes
-- through occurrence_id -> class_occurrences.department_id (already
-- populated, already the join every other Overview column uses), not
-- duplicated onto this table.
--
-- client_mindbody_unique_id is intentionally NOT a foreign key into
-- clients: the roster sync and the per-occurrence visits sync are two
-- independent MindBody pulls that can run at different times, and a visit
-- for a client whose roster row hasn't synced yet (or never will, e.g. a
-- since-purged prospect) shouldn't fail or block the visits sync. Joined
-- by (organization_id, mindbody_unique_id) in queries instead, same
-- provenance-not-join-target convention already used for
-- sales.client_id/appointment_occurrences.client_id.
create table class_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id),
  occurrence_id uuid not null references class_occurrences (id) on delete cascade,
  client_mindbody_unique_id integer not null,
  signed_in boolean not null,
  synced_at timestamptz not null default now(),
  unique (organization_id, occurrence_id, client_mindbody_unique_id)
);

alter table class_visits enable row level security;

create policy "class_visits_select_same_org"
  on class_visits for select
  to authenticated
  using (organization_id = private.current_staff_org_id());

create index class_visits_occurrence_idx on class_visits (occurrence_id);
create index class_visits_org_client_idx on class_visits (organization_id, client_mindbody_unique_id);

commit;
